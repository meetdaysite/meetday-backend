import { MediaType, Prisma, RefundTo, RefundType, Visibility } from '@prisma/client';

/** Same-city moves within this radius are MINOR; anything further (or a city change) is MAJOR. */
export const VENUE_MINOR_RADIUS_METERS = 1000;

export type VenueMateriality = 'MINOR' | 'MAJOR';

/**
 * The full set of event fields that can be applied in one merge. Used both by the draft-update
 * path (`CreateEventDto`) and by the revision-approval path (a stored `changes` JSON). Every field
 * is optional; only the keys actually present are written — an absent key means "leave as-is".
 */
export interface EventChanges {
  categoryId?: string;
  title?: string;
  description?: string;
  eventType?: string;
  languages?: string[];
  tags?: string[];
  eventDate?: string;
  startTime?: string;
  endTime?: string;
  venueName?: string;
  fullAddress?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  whatToExpect?: string[];
  whoShouldAttend?: string[];
  visibility?: Visibility;
  ageRestriction?: string;
  specialInstructions?: string;
  isFree?: boolean;
  tickets?: Array<{
    name?: string;
    price?: number;
    isFree?: boolean;
    totalCapacity?: number;
    maxPerPerson?: number;
    description?: string;
    saleStartDate?: string;
    saleEndDate?: string;
  }>;
  refundPolicy?: {
    type?: RefundType;
    cutoffHours?: number;
    refundPercent?: number;
    refundTo?: RefundTo;
  };
  media?: Array<{ key: string; type: MediaType; order?: number }>;
}

/**
 * Applies a partial set of changes onto an event inside a transaction. Shared by the DRAFT update
 * flow and the published-event revision-approval flow so the merge semantics stay identical:
 * scalar fields are patched conditionally, and tickets/refundPolicy/media (when present) fully
 * replace what exists — the caller must send the complete desired set, not a delta.
 */
export async function applyEventChanges(
  tx: Prisma.TransactionClient,
  eventId: string,
  changes: EventChanges,
): Promise<void> {
  await tx.event.update({
    where: { id: eventId },
    data: {
      ...(changes.categoryId !== undefined && { categoryId: changes.categoryId }),
      ...(changes.title !== undefined && { title: changes.title }),
      ...(changes.description !== undefined && { description: changes.description }),
      ...(changes.eventType !== undefined && { eventType: changes.eventType }),
      ...(changes.languages !== undefined && { languages: changes.languages }),
      ...(changes.tags !== undefined && { tags: changes.tags }),
      ...(changes.eventDate !== undefined && { eventDate: new Date(changes.eventDate) }),
      ...(changes.startTime !== undefined && { startTime: changes.startTime }),
      ...(changes.endTime !== undefined && { endTime: changes.endTime }),
      ...(changes.venueName !== undefined && { venueName: changes.venueName }),
      ...(changes.fullAddress !== undefined && { fullAddress: changes.fullAddress }),
      ...(changes.city !== undefined && { city: changes.city }),
      ...(changes.latitude !== undefined && { latitude: changes.latitude }),
      ...(changes.longitude !== undefined && { longitude: changes.longitude }),
      ...(changes.whatToExpect !== undefined && { whatToExpect: changes.whatToExpect }),
      ...(changes.whoShouldAttend !== undefined && { whoShouldAttend: changes.whoShouldAttend }),
      ...(changes.visibility !== undefined && { visibility: changes.visibility }),
      ...(changes.ageRestriction !== undefined && { ageRestriction: changes.ageRestriction }),
      ...(changes.specialInstructions !== undefined && { specialInstructions: changes.specialInstructions }),
      ...(changes.isFree !== undefined && { isFree: changes.isFree }),
    },
  });

  if (changes.tickets !== undefined) {
    await tx.eventTicket.deleteMany({ where: { eventId } });
    if (changes.tickets.length > 0) {
      await tx.eventTicket.createMany({
        data: changes.tickets.map((t) => ({
          eventId,
          name: t.name as string,
          price: t.price ?? 0,
          isFree: t.isFree ?? false,
          totalCapacity: t.totalCapacity ?? 0,
          maxPerPerson: t.maxPerPerson,
          description: t.description,
          saleStartDate: t.saleStartDate ? new Date(t.saleStartDate) : null,
          saleEndDate: t.saleEndDate ? new Date(t.saleEndDate) : null,
        })),
      });
    }
  }

  if (changes.refundPolicy !== undefined) {
    await tx.eventRefundPolicy.upsert({
      where: { eventId },
      create: {
        eventId,
        type: changes.refundPolicy.type!,
        cutoffHours: changes.refundPolicy.cutoffHours,
        refundPercent: changes.refundPolicy.refundPercent,
        refundTo: changes.refundPolicy.refundTo!,
      },
      update: {
        ...(changes.refundPolicy.type !== undefined && { type: changes.refundPolicy.type }),
        ...(changes.refundPolicy.cutoffHours !== undefined && { cutoffHours: changes.refundPolicy.cutoffHours }),
        ...(changes.refundPolicy.refundPercent !== undefined && { refundPercent: changes.refundPolicy.refundPercent }),
        ...(changes.refundPolicy.refundTo !== undefined && { refundTo: changes.refundPolicy.refundTo }),
      },
    });
  }

  if (changes.media !== undefined) {
    await tx.eventMedia.deleteMany({ where: { eventId } });
    if (changes.media.length > 0) {
      await tx.eventMedia.createMany({
        data: changes.media.map((m) => ({
          eventId,
          url: m.key,
          type: m.type,
          order: m.order ?? 0,
        })),
      });
    }
  }
}

/** Great-circle distance between two lat/long points, in metres. */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Sizes a proposed venue change so we can react proportionally on approval:
 *  - MAJOR: the city changed, or the venue moved more than {@link VENUE_MINOR_RADIUS_METERS},
 *           or coordinates are missing/unverifiable → attendees get email + in-app notice.
 *  - MINOR: same city, small move → a soft in-app notice only.
 */
export function classifyVenueChange(
  current: { city: string | null; latitude: Prisma.Decimal | null; longitude: Prisma.Decimal | null },
  changes: Pick<EventChanges, 'city' | 'latitude' | 'longitude'>,
): VenueMateriality {
  if (changes.city !== undefined) {
    if (current.city === null) return 'MAJOR';
    if (changes.city.trim().toLowerCase() !== current.city.trim().toLowerCase()) return 'MAJOR';
  }

  const curLat = current.latitude === null ? null : Number(current.latitude);
  const curLng = current.longitude === null ? null : Number(current.longitude);
  const newLat = changes.latitude ?? curLat;
  const newLng = changes.longitude ?? curLng;

  if (curLat === null || curLng === null || newLat === null || newLng === null) return 'MAJOR';

  return haversineMeters(curLat, curLng, newLat, newLng) > VENUE_MINOR_RADIUS_METERS ? 'MAJOR' : 'MINOR';
}
