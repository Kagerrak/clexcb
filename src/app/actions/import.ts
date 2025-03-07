// app/actions/import.ts
'use server';

import { prisma } from '@/lib/prisma';
import { validateSession } from '@/lib/auth';
import { revalidatePath } from 'next/cache';

import type { 
  ShipmentData, 
  DocumentStatus 
} from '@/types/import/workflow';
import type { ImportTransactionType } from '@/lib/utils/reference-number';
import type { ShipmentListItem } from '@/types/import';
import type { User } from '@/types/auth';

// Helper function to get the current user or throw if unauthorized
async function getCurrentUser(): Promise<User> {
  const session = await validateSession();
  if (!session?.user) {
    throw new Error('Unauthorized');
  }
  return session.user;
}

export async function createShipmentAction(data: {
  shipmentType: ImportTransactionType;
  formData: Partial<ShipmentData>;
}) {
  try {
    const user = await getCurrentUser();

    return await prisma.$transaction(async (tx) => {
      let consigneeId: string | null = null;
      let exporterId: string | null = null;

      // Handle Consignee
      if (data.formData.consignee) {
        if (data.formData.consignee.id) {
        const existingConsignee = await tx.consignee.findFirst({
          where: {
            OR: [
              { tin: data.formData.consignee.tin },
              { name: data.formData.consignee.name }
            ],
            userId: user.id
          }
        });

        if (existingConsignee) {
          consigneeId = existingConsignee.id;
        } else {
          const newConsignee = await tx.consignee.create({
            data: {
              name: data.formData.consignee.name,
              registeredName: data.formData.consignee.name,
              businessAddress: data.formData.consignee.address,
              tin: data.formData.consignee.tin || '',
              brn: data.formData.consignee.brn || '',
              contactPerson: data.formData.shipmentDetails?.contact_person || '',
              contactNumber: data.formData.shipmentDetails?.contact_number || '',
              email: '',
              userId: user.id
            }
          });
          consigneeId = newConsignee.id;
        }
      }}

      // Handle Exporter
      if (data.formData.exporter) {
        const existingExporter = await tx.exporter.findFirst({
          where: {
            AND: [
              { name: data.formData.exporter.name },
              { businessAddress: data.formData.exporter.address }
            ],
            userId: user.id
          }
        });

        if (existingExporter) {
          exporterId = existingExporter.id;
        } else {
          const newExporter = await tx.exporter.create({
            data: {
              name: data.formData.exporter.name,
              businessAddress: data.formData.exporter.address,
              contactPerson: '',
              contactNumber: '',
              email: '',
              userId: user.id
            }
          });
          exporterId = newExporter.id;
        }
      }

      const shipment = await tx.shipment.create({
        data: {
          referenceNumber: `CLEX-${data.shipmentType}${new Date().getFullYear().toString().slice(-2)}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`,
          freightType: data.shipmentType,
          status: 'CLIENT_DETAILS',
          consigneeId,
          exporterId,
          userId: user.id,
          consigneeData: JSON.stringify(data.formData.consignee || {}),
          exporterData: JSON.stringify(data.formData.exporter || {}),
          shipmentDetails: JSON.stringify(data.formData.shipmentDetails || {}),
          documentsData: JSON.stringify(data.formData.documents || []),
          timelineData: JSON.stringify([{
            status: 'CLIENT_DETAILS',
            timestamp: new Date(),
            description: 'Shipment created'
          }]),
          notesData: JSON.stringify([]),
          computations: JSON.stringify({})
        }
      });

      return {
        success: true,
        referenceNumber: shipment.referenceNumber,
        shipment
      };
    });
  } catch (error) {
    console.error('Error in shipment creation:', error);
    throw new Error('Failed to create shipment');
  }
}

export async function getSavedEntitiesAction(type: 'consignee' | 'exporter') {
  try {
    const user = await getCurrentUser();

    if (type === 'consignee') {
      const consignees = await prisma.consignee.findMany({
        where: {
          userId: user.id
        },
        select: {
          id: true,
          name: true,
          businessAddress: true,
          tin: true,
          brn: true,
          contactPerson: true,
          contactNumber: true,
          email: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      return consignees.map(c => ({
        id: c.id,
        name: c.name,
        address: c.businessAddress,
        tin: c.tin,
        brn: c.brn,
        contactPerson: c.contactPerson,
        contactNumber: c.contactNumber,
        email: c.email
      }));
    } else {
      const exporters = await prisma.exporter.findMany({
        where: {
          userId: user.id
        },
        select: {
          id: true,
          name: true,
          businessAddress: true,
          contactPerson: true,
          contactNumber: true,
          email: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      return exporters.map(e => ({
        id: e.id,
        name: e.name,
        address: e.businessAddress,
        contactPerson: e.contactPerson,
        contactNumber: e.contactNumber,
        email: e.email
      }));
    }
  } catch (error) {
    console.error(`Error fetching ${type}s:`, error);
    return [];
  }
}

export async function processDocumentUploadAction(
  shipmentId: string,
  documentType: string,
  file: File
): Promise<{ success: boolean; fileUrl: string; status: DocumentStatus }> {
  try {
    const user = await getCurrentUser();

    // Get current shipment and verify ownership
    const shipment = await prisma.shipment.findUnique({
      where: { 
        id: shipmentId,
        userId: user.id
      }
    });

    if (!shipment) {
      throw new Error('Shipment not found or unauthorized');
    }

    // Simulate file upload delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    const timestamp = new Date().getTime();
    const simulatedUrl = `/simulated-uploads/${shipmentId}/${documentType}-${timestamp}-${file.name}`;

    // Parse and update documents
    const documents = JSON.parse(shipment.documentsData);
    const updatedDocuments = documents.map((doc: any) => {
      if (doc.name === documentType) {
        return {
          ...doc,
          status: 'draft' as DocumentStatus,
          files: [...(doc.files || []), simulatedUrl]
        };
      }
      return doc;
    });

    await prisma.shipment.update({
      where: { id: shipmentId },
      data: {
        documentsData: JSON.stringify(updatedDocuments)
      }
    });

    return {
      success: true,
      fileUrl: simulatedUrl,
      status: 'draft' as DocumentStatus
    };
  } catch (error) {
    console.error('Error processing document upload:', error);
    throw new Error('Failed to process document upload');
  }
}

export async function getShipmentsAction(): Promise<{ success: boolean; data: ShipmentListItem[] }> {
  try {
    const user = await getCurrentUser();

    const shipments = await prisma.shipment.findMany({
      where: {
        userId: user.id
      },
      include: {
        consignee: true,
        exporter: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const transformedShipments: ShipmentListItem[] = shipments.map(shipment => {
      const shipmentDetails = JSON.parse(shipment.shipmentDetails);
      const shipmentType = shipment.freightType === 'IMS' ? 'sea' as const : 'air' as const;

      return {
        id: shipment.id,
        referenceNumber: shipment.referenceNumber,
        consignee: shipment.consignee?.name || JSON.parse(shipment.consigneeData).name || 'N/A',
        type: shipmentType,
        blNumber: shipmentType === 'sea' ? shipmentDetails.bl_number || undefined : undefined,
        awbNumber: shipmentType === 'air' ? shipmentDetails.awb_number || undefined : undefined,
        status: shipment.status,
        eta: shipmentDetails.eta || null,
        completionDate: shipment.completionDate?.toISOString() || null,
        lastUpdate: shipment.updatedAt.toISOString(),
        isLocked: shipment.isLocked
      };
    });

    return {
      success: true,
      data: transformedShipments
    };
  } catch (error) {
    console.error('Error fetching shipments:', error);
    return {
      success: false,
      data: []
    };
  }
}

export async function getShipmentByIdAction(id: string): Promise<ShipmentData | null> {
  try {
    const user = await getCurrentUser();

    const shipment = await prisma.shipment.findUnique({
      where: { 
        id,
        userId: user.id
      },
      include: {
        consignee: {
          include: {
            documents: true
          }
        },
        exporter: true
      }
    });

    if (!shipment) return null;

    // Combine database relations with JSON data for backward compatibility
    const consigneeData = shipment.consignee 
      ? {
          id: shipment.consignee.id,
          name: shipment.consignee.name,
          address: shipment.consignee.businessAddress,
          tin: shipment.consignee.tin,
          brn: shipment.consignee.brn,
          contactPerson: shipment.consignee.contactPerson,
          contactNumber: shipment.consignee.contactNumber,
          email: shipment.consignee.email,
          documents: shipment.consignee.documents
        }
      : JSON.parse(shipment.consigneeData);

    const exporterData = shipment.exporter
      ? {
          id: shipment.exporter.id,
          name: shipment.exporter.name,
          address: shipment.exporter.businessAddress,
          contactPerson: shipment.exporter.contactPerson,
          contactNumber: shipment.exporter.contactNumber,
          email: shipment.exporter.email
        }
      : JSON.parse(shipment.exporterData);

    return {
      id: shipment.id,
      referenceNumber: shipment.referenceNumber,
      status: shipment.status,
      consignee: consigneeData,
      exporter: exporterData,
      shipmentDetails: JSON.parse(shipment.shipmentDetails),
      documents: JSON.parse(shipment.documentsData),
      timeline: JSON.parse(shipment.timelineData),
      notes: JSON.parse(shipment.notesData),
      computations: shipment.computations ? JSON.parse(shipment.computations) : null,
      cargo: shipment.cargoData ? JSON.parse(shipment.cargoData) : [],
      statementOfFacts: shipment.statementOfFactsData 
        ? JSON.parse(shipment.statementOfFactsData) 
        : []
    };
  } catch (error) {
    console.error('Error fetching shipment:', error);
    return null;
  }
}

export async function updateShipmentStatusAction(
  id: string,
  status: string,
  timelineUpdate?: { stage: string; status: string; timestamp: string }
) {
  try {
    const user = await getCurrentUser();

    const shipment = await prisma.shipment.findUnique({
      where: { 
        id,
        userId: user.id
      }
    });

    if (!shipment) throw new Error('Shipment not found');

    const timeline = JSON.parse(shipment.timelineData);
    const updatedTimeline = timelineUpdate ? [...timeline, timelineUpdate] : timeline;

    await prisma.shipment.update({
      where: { id },
      data: {
        status,
        timelineData: JSON.stringify(updatedTimeline),
        updatedAt: new Date()
      }
    });

    revalidatePath(`/admin/services/import/${id}`);
    return true;
  } catch (error) {
    console.error('Error updating shipment status:', error);
    return false;
  }
}

export async function updateShipmentDetailsAction(
  id: string,
  updates: Partial<ShipmentData>
): Promise<{ success: true; data: ShipmentData } | { success: false; error: string }> {
  try {
    const user = await getCurrentUser();

    const currentShipment = await prisma.shipment.findUnique({
      where: { 
        id,
        userId: user.id
      }
    });

    if (!currentShipment) {
      throw new Error('Shipment not found');
    }

    // Prepare update data
    const updateData: any = {};

    // Handle consignee updates with proper relations
    if (updates.consignee) {
      let consigneeId = currentShipment.consigneeId;
      if (updates.consignee.id) {
        const consignee = await prisma.consignee.findUnique({
          where: { id: updates.consignee.id }
        });
        if (consignee) {
          consigneeId = consignee.id;
        }
      }
      updateData.consigneeId = consigneeId;
      updateData.consigneeData = JSON.stringify(updates.consignee);
    }

    // Handle exporter updates
    if (updates.exporter) {
      let exporterId = currentShipment.exporterId;
      if (updates.exporter.id) {
        const exporter = await prisma.exporter.findUnique({
          where: { id: updates.exporter.id }
        });
        if (exporter) {
          exporterId = exporter.id;
        }
      }
      updateData.exporterId = exporterId;
      updateData.exporterData = JSON.stringify(updates.exporter);
    }

    // Handle other updates
    if (updates.shipmentDetails) {
      updateData.shipmentDetails = JSON.stringify(updates.shipmentDetails);
    }
    if (updates.documents) {
      updateData.documentsData = JSON.stringify(updates.documents);
    }
    if (updates.timeline) {
      updateData.timelineData = JSON.stringify(updates.timeline);
    }
    if (updates.notes) {
      updateData.notesData = JSON.stringify(updates.notes);
    }
    if (updates.cargo) {
      updateData.cargoData = JSON.stringify(updates.cargo);
    }
    if (updates.statementOfFacts) {
      updateData.statementOfFactsData = JSON.stringify(updates.statementOfFacts);
    }

    // Update the shipment
    const updated = await prisma.shipment.update({
      where: { id },
      data: {
        ...updateData,
        updatedAt: new Date(),
      },
      include: {
        consignee: {
          include: {
            documents: true
          }
        },
        exporter: true
      }
    });

    // Parse and format the updated data
    const parsedData: ShipmentData = {
      id: updated.id,
      referenceNumber: updated.referenceNumber,
      status: updated.status,
      consignee: updated.consignee 
        ? {
            id: updated.consignee.id,
            name: updated.consignee.name,
            address: updated.consignee.businessAddress,
            tin: updated.consignee.tin,
            brn: updated.consignee.brn,
            contactPerson: updated.consignee.contactPerson,
            contactNumber: updated.consignee.contactNumber,
            email: updated.consignee.email,
            documents: updated.consignee.documents.map(doc => ({
              id: doc.id,
              name: doc.name,
              url: doc.fileUrl,
              uploadedAt: doc.uploadedAt,
              isVerified: doc.isVerified
            }))
          }
        : JSON.parse(updated.consigneeData),
      exporter: updated.exporter
        ? {
            id: updated.exporter.id,
            name: updated.exporter.name,
            address: updated.exporter.businessAddress,
            contactPerson: updated.exporter.contactPerson,
            contactNumber: updated.exporter.contactNumber,
            email: updated.exporter.email
          }
        : JSON.parse(updated.exporterData),
      shipmentDetails: JSON.parse(updated.shipmentDetails),
      documents: JSON.parse(updated.documentsData),
      timeline: JSON.parse(updated.timelineData),
      notes: JSON.parse(updated.notesData),
      computations: updated.computations ? JSON.parse(updated.computations) : null,
      cargo: updated.cargoData ? JSON.parse(updated.cargoData) : [],
      statementOfFacts: updated.statementOfFactsData 
        ? JSON.parse(updated.statementOfFactsData) 
        : []
    };

    revalidatePath(`/admin/services/import/${id}`);
    return {
      success: true,
      data: parsedData
    };
  } catch (error) {
    console.error('Error updating shipment:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update shipment'
    };
  }
}

export async function linkClientToShipmentAction(
  shipmentId: string,
  clientId: string,
  type: 'consignee' | 'exporter'
) {
  try {
    const user = await getCurrentUser();

    const shipment = await prisma.shipment.findUnique({
      where: { 
        id: shipmentId,
        userId: user.id
      }
    });

    if (!shipment) {
      throw new Error('Shipment not found');
    }

    // Check if client exists and belongs to user
    const clientExists = type === 'consignee'
      ? await prisma.consignee.findFirst({
          where: {
            id: clientId,
            userId: user.id
          }
        })
      : await prisma.exporter.findFirst({
          where: {
            id: clientId,
            userId: user.id
          }
        });

    if (!clientExists) {
      throw new Error(`${type} not found or unauthorized`);
    }

    // Update shipment with client link
    const updated = await prisma.shipment.update({
      where: { id: shipmentId },
      data: type === 'consignee'
        ? { consigneeId: clientId }
        : { exporterId: clientId },
      include: {
        consignee: {
          include: {
            documents: true
          }
        },
        exporter: true
      }
    });

    revalidatePath(`/admin/services/import/${shipmentId}`);
    return { success: true, shipment: updated };
  } catch (error) {
    console.error('Error linking client to shipment:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to link client' 
    };
  }
}

export async function createClientDuringShipmentAction(
  data: {
    type: 'consignee' | 'exporter';
    name: string;
    address: string;
    [key: string]: any; // Additional fields
  }
) {
  try {
    const user = await getCurrentUser();

    if (data.type === 'consignee') {
      const consignee = await prisma.consignee.create({
        data: {
          name: data.name,
          businessAddress: data.address,
          registeredName: data.registeredName || data.name,
          tin: data.tin || '',
          brn: data.brn || '',
          contactPerson: data.contactPerson || '',
          contactNumber: data.contactNumber || '',
          email: data.email || '',
          userId: user.id
        }
      });
      return { success: true, client: consignee };
    } else {
      const exporter = await prisma.exporter.create({
        data: {
          name: data.name,
          businessAddress: data.address,
          contactPerson: data.contactPerson || '',
          contactNumber: data.contactNumber || '',
          email: data.email || '',
          userId: user.id
        }
      });
      return { success: true, client: exporter };
    }
  } catch (error) {
    console.error('Error creating client:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to create client' 
    };
  }
}