import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus, Visibility } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async createEvent(userId: string, dto: CreateEventDto) {
    const hostProfile = await this.prisma.hostProfile.findUnique({
      where: { userId },
      select: { id: true, approvalStatus: true },
    });
    if (!hostProfile) throw new NotFoundException('Host profile not found');
    if (hostProfile.approvalStatus !== 'APPROVED')
      throw new ForbiddenException('Host must be approved to create events');

    if (dto.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: dto.categoryId, isActive: true },
        select: { id: true },
      });
      if (!category) throw new NotFoundException('Category not found or inactive');
    }

    if (dto.isFree && dto.tickets?.some((t) => (t.price ?? 0) !== 0))
      throw new BadRequestException('All ticket prices must be 0 for a free event');

    return this.prisma.$transaction(async (tx) => {
      return tx.event.create({
        data: {
          hostProfileId: hostProfile.id,
          categoryId: dto.categoryId,
          title: dto.title,
          description: dto.description,
          eventType: dto.eventType,
          languages: dto.languages ?? [],
          tags: dto.tags ?? [],
          eventDate: dto.eventDate ? new Date(dto.eventDate) : null,
          startTime: dto.startTime,
          endTime: dto.endTime,
          venueName: dto.venueName,
          fullAddress: dto.fullAddress,
          city: dto.city,
          latitude: dto.latitude,
          longitude: dto.longitude,
          whatToExpect: dto.whatToExpect ?? [],
          whoShouldAttend: dto.whoShouldAttend ?? [],
          visibility: dto.visibility ?? Visibility.PUBLIC,
          ageRestriction: dto.ageRestriction,
          specialInstructions: dto.specialInstructions,
          isFree: dto.isFree ?? false,
          status: EventStatus.DRAFT,
          ...(dto.tickets && {
            tickets: {
              create: dto.tickets.map((t) => ({
                name: t.name as string,
                price: t.price ?? 0,
                totalCapacity: t.totalCapacity ?? 0,
                maxPerPerson: t.maxPerPerson,
                description: t.description,
                saleStartDate: t.saleStartDate ? new Date(t.saleStartDate) : null,
                saleEndDate: t.saleEndDate ? new Date(t.saleEndDate) : null,
              })),
            },
          }),
          ...(dto.refundPolicy && {
            refundPolicy: {
              create: {
                type: dto.refundPolicy.type!,
                cutoffHours: dto.refundPolicy.cutoffHours,
                refundPercent: dto.refundPolicy.refundPercent,
                refundTo: dto.refundPolicy.refundTo!,
              },
            },
          }),
        },
        include: {
          tickets: true,
          refundPolicy: true,
          category: { select: { id: true, name: true } },
        },
      });
    });
  }

  async updateEvent(userId: string, eventId: string, dto: CreateEventDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { hostProfile: { select: { userId: true } } },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.hostProfile.userId !== userId)
      throw new ForbiddenException('You do not own this event');
    if (event.status !== EventStatus.DRAFT)
      throw new ForbiddenException('Only DRAFT events can be edited');

    if (dto.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: dto.categoryId, isActive: true },
        select: { id: true },
      });
      if (!category) throw new NotFoundException('Category not found or inactive');
    }

    const isFree = dto.isFree ?? (event.isFree as boolean);
    if (dto.tickets && isFree && dto.tickets.some((t) => (t.price ?? 0) !== 0))
      throw new BadRequestException('All ticket prices must be 0 for a free event');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.event.update({
        where: { id: eventId },
        data: {
          ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.eventType !== undefined && { eventType: dto.eventType }),
          ...(dto.languages !== undefined && { languages: dto.languages }),
          ...(dto.tags !== undefined && { tags: dto.tags }),
          ...(dto.eventDate !== undefined && { eventDate: new Date(dto.eventDate) }),
          ...(dto.startTime !== undefined && { startTime: dto.startTime }),
          ...(dto.endTime !== undefined && { endTime: dto.endTime }),
          ...(dto.venueName !== undefined && { venueName: dto.venueName }),
          ...(dto.fullAddress !== undefined && { fullAddress: dto.fullAddress }),
          ...(dto.city !== undefined && { city: dto.city }),
          ...(dto.latitude !== undefined && { latitude: dto.latitude }),
          ...(dto.longitude !== undefined && { longitude: dto.longitude }),
          ...(dto.whatToExpect !== undefined && { whatToExpect: dto.whatToExpect }),
          ...(dto.whoShouldAttend !== undefined && { whoShouldAttend: dto.whoShouldAttend }),
          ...(dto.visibility !== undefined && { visibility: dto.visibility }),
          ...(dto.ageRestriction !== undefined && { ageRestriction: dto.ageRestriction }),
          ...(dto.specialInstructions !== undefined && { specialInstructions: dto.specialInstructions }),
          ...(dto.isFree !== undefined && { isFree: dto.isFree }),
        },
        include: {
          tickets: true,
          refundPolicy: true,
          category: { select: { id: true, name: true } },
        },
      });

      if (dto.tickets !== undefined) {
        await tx.eventTicket.deleteMany({ where: { eventId } });
        if (dto.tickets.length > 0) {
          await tx.eventTicket.createMany({
            data: dto.tickets.map((t) => ({
              eventId,
              name: t.name as string,
              price: t.price ?? 0,
              totalCapacity: t.totalCapacity ?? 0,
              maxPerPerson: t.maxPerPerson,
              description: t.description,
              saleStartDate: t.saleStartDate ? new Date(t.saleStartDate) : null,
              saleEndDate: t.saleEndDate ? new Date(t.saleEndDate) : null,
            })),
          });
        }
      }

      if (dto.refundPolicy !== undefined) {
        await tx.eventRefundPolicy.upsert({
          where: { eventId },
          create: {
            eventId,
            type: dto.refundPolicy.type!,
            cutoffHours: dto.refundPolicy.cutoffHours,
            refundPercent: dto.refundPolicy.refundPercent,
            refundTo: dto.refundPolicy.refundTo!,
          },
          update: {
            ...(dto.refundPolicy.type !== undefined && { type: dto.refundPolicy.type }),
            ...(dto.refundPolicy.cutoffHours !== undefined && { cutoffHours: dto.refundPolicy.cutoffHours }),
            ...(dto.refundPolicy.refundPercent !== undefined && { refundPercent: dto.refundPolicy.refundPercent }),
            ...(dto.refundPolicy.refundTo !== undefined && { refundTo: dto.refundPolicy.refundTo }),
          },
        });
      }

      return tx.event.findUnique({
        where: { id: eventId },
        include: {
          tickets: true,
          refundPolicy: true,
          category: { select: { id: true, name: true } },
        },
      });
    });
  }

  async submitEvent(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        hostProfile: { select: { userId: true } },
        tickets: { select: { id: true } },
        refundPolicy: { select: { id: true } },
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.hostProfile.userId !== userId)
      throw new ForbiddenException('You do not own this event');
    if (event.status !== EventStatus.DRAFT)
      throw new ForbiddenException('Only DRAFT events can be submitted for review');

    const missing: string[] = [];
    if (!event.title) missing.push('title');
    if (!event.description) missing.push('description');
    if (!event.eventType) missing.push('eventType');
    if (!event.categoryId) missing.push('categoryId');
    if (!event.languages?.length) missing.push('languages');
    if (!event.eventDate) missing.push('eventDate');
    if (!event.startTime) missing.push('startTime');
    if (!event.endTime) missing.push('endTime');
    if (!event.venueName) missing.push('venueName');
    if (!event.fullAddress) missing.push('fullAddress');
    if (!(event.whatToExpect as string[])?.length) missing.push('whatToExpect');
    if (!(event.whoShouldAttend as string[])?.length) missing.push('whoShouldAttend');
    if (!event.tickets.length) missing.push('tickets');
    if (!event.refundPolicy) missing.push('refundPolicy');

    if (missing.length)
      throw new BadRequestException(`Event is incomplete. Missing: ${missing.join(', ')}`);

    return this.prisma.event.update({
      where: { id: eventId },
      data: { status: EventStatus.UNDER_REVIEW },
      include: {
        tickets: true,
        refundPolicy: true,
        category: { select: { id: true, name: true } },
      },
    });
  }
}
