import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, CommunityMemberStatus, CommunityRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AdminListMembersQueryDto, GenerateInviteDto } from './dto/admin-list-members-query.dto';

const ENTITY_TYPE = 'COMMUNITY_MEMBER';

const deltaPct = (current: number, prior: number) =>
  Math.round(((current - prior) / Math.max(prior, 1)) * 100);

const engagementFromScore = (score: number) => {
  const pct = Math.min(Math.round((score / 60) * 100), 100);
  const level = pct >= 75 ? 'high' : pct >= 30 ? 'medium' : 'low';
  return { engagementPct: pct, engagementLevel: level };
};

@Injectable()
export class CommunityMembersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ── Stats cards ────────────────────────────────────────────────────────────

  async getMemberStats(communityId: string) {
    const cacheKey = `admin:member-stats:${communityId}`;
    const cached = await this.redis.get<unknown>(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const window30Start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const window60Start = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const [
      community,
      active30d,
      activePrior30d,
      new30d,
      newPrior30d,
      totalBeforeWindow,
      stillActiveFromBefore,
      tabCounts,
    ] = await Promise.all([
      this.prisma.community.findUnique({ where: { id: communityId }, select: { memberCount: true } }),
      this.prisma.communityMember.count({
        where: { communityId, status: CommunityMemberStatus.ACTIVE, lastActivityAt: { gte: window30Start } },
      }),
      this.prisma.communityMember.count({
        where: {
          communityId,
          status: CommunityMemberStatus.ACTIVE,
          lastActivityAt: { gte: window60Start, lt: window30Start },
        },
      }),
      this.prisma.communityMember.count({
        where: { communityId, status: CommunityMemberStatus.ACTIVE, joinedAt: { gte: window30Start } },
      }),
      this.prisma.communityMember.count({
        where: { communityId, status: CommunityMemberStatus.ACTIVE, joinedAt: { gte: window60Start, lt: window30Start } },
      }),
      // retention: members who joined before current 30d window
      this.prisma.communityMember.count({
        where: { communityId, joinedAt: { lt: window30Start } },
      }),
      // of those, still ACTIVE
      this.prisma.communityMember.count({
        where: { communityId, status: CommunityMemberStatus.ACTIVE, joinedAt: { lt: window30Start } },
      }),
      // tab counts in parallel
      Promise.all([
        // ALL: active + pending + invited
        this.prisma.communityMember.count({
          where: { communityId, status: { in: [CommunityMemberStatus.ACTIVE, CommunityMemberStatus.PENDING, CommunityMemberStatus.INVITED] } },
        }),
        // ACTIVE: active + recently active
        this.prisma.communityMember.count({
          where: { communityId, status: CommunityMemberStatus.ACTIVE, lastActivityAt: { gte: window30Start } },
        }),
        // NEW: joined in 30d
        this.prisma.communityMember.count({
          where: { communityId, status: CommunityMemberStatus.ACTIVE, joinedAt: { gte: window30Start } },
        }),
        // INACTIVE
        this.prisma.communityMember.count({
          where: {
            communityId,
            status: CommunityMemberStatus.ACTIVE,
            OR: [{ lastActivityAt: { lt: window30Start } }, { lastActivityAt: null }],
          },
        }),
        // BANNED
        this.prisma.communityMember.count({ where: { communityId, status: CommunityMemberStatus.BANNED } }),
      ]),
    ]);

    const total = community?.memberCount ?? 0;
    const priorActive = activePrior30d;
    const engagementValue = total > 0 ? Math.round((active30d / total) * 100) : 0;
    const priorEngagement = total > 0 ? Math.round((priorActive / total) * 100) : 0;
    const retentionValue = totalBeforeWindow > 0 ? Math.round((stillActiveFromBefore / totalBeforeWindow) * 100) : 0;

    const [allCount, activeCount, newCount, inactiveCount, bannedCount] = tabCounts;

    const result = {
      totalMembers: total,
      activeMembers: { value: active30d, deltaPct: deltaPct(active30d, priorActive) },
      newMembers: { value: new30d, deltaPct: deltaPct(new30d, newPrior30d) },
      engagementRate: { value: engagementValue, deltaPct: deltaPct(engagementValue, priorEngagement) },
      retentionRate: { value: retentionValue, deltaPct: 0 },
      tabCounts: { all: allCount, active: activeCount, new: newCount, inactive: inactiveCount, banned: bannedCount },
    };

    await this.redis.set(cacheKey, result, 60);
    return result;
  }

  // ── Member list ────────────────────────────────────────────────────────────

  async listMembersAdmin(communityId: string, query: AdminListMembersQueryDto) {
    const { page = 1, limit = 20, status = 'ALL', role, sort = 'RECENTLY_JOINED', search, from, to } = query;
    const skip = (page - 1) * limit;

    const now = new Date();
    const window30Start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    let statusWhere: Record<string, unknown>;
    switch (status) {
      case 'ACTIVE':
        statusWhere = { status: CommunityMemberStatus.ACTIVE, lastActivityAt: { gte: window30Start } };
        break;
      case 'NEW':
        statusWhere = { status: CommunityMemberStatus.ACTIVE, joinedAt: { gte: window30Start } };
        break;
      case 'INACTIVE':
        statusWhere = {
          status: CommunityMemberStatus.ACTIVE,
          OR: [{ lastActivityAt: { lt: window30Start } }, { lastActivityAt: null }],
        };
        break;
      case 'BANNED':
        statusWhere = { status: CommunityMemberStatus.BANNED };
        break;
      default: // ALL
        statusWhere = { status: { in: [CommunityMemberStatus.ACTIVE, CommunityMemberStatus.PENDING, CommunityMemberStatus.INVITED] } };
    }

    const where: Record<string, unknown> = {
      communityId,
      ...statusWhere,
      ...(role ? { role } : {}),
      ...(from || to
        ? {
            joinedAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            user: {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    let orderBy: Record<string, unknown> | Record<string, unknown>[];
    switch (sort) {
      case 'LAST_ACTIVE':
        orderBy = { lastActivityAt: 'desc' };
        break;
      case 'ENGAGEMENT':
        orderBy = { activityScore: 'desc' };
        break;
      case 'ALPHABETICAL':
        orderBy = { user: { firstName: 'asc' } };
        break;
      default:
        orderBy = { joinedAt: 'desc' };
    }

    const [members, total] = await Promise.all([
      this.prisma.communityMember.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true },
          },
        },
      }),
      this.prisma.communityMember.count({ where }),
    ]);

    const items = await Promise.all(
      members.map(async (m) => {
        const avatarUrl = m.user.avatarUrl
          ? await this.storage.getPresignedDownloadUrl(m.user.avatarUrl)
          : null;
        return {
          userId: m.user.id,
          name: `${m.user.firstName} ${m.user.lastName}`.trim(),
          email: m.user.email,
          avatarUrl,
          role: m.role,
          status: m.status,
          joinedAt: m.joinedAt,
          lastActiveAt: m.lastActivityAt,
          ...engagementFromScore(m.activityScore),
          activityScore: m.activityScore,
          messageCount: m.messageCount,
          eventsAttendedCount: m.eventsAttendedCount,
          bannedAt: m.bannedAt,
        };
      }),
    );

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ── Member detail ──────────────────────────────────────────────────────────

  async getMemberDetail(communityId: string, targetUserId: string) {
    const member = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId: targetUserId } },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true, createdAt: true },
        },
      },
    });
    if (!member) throw new NotFoundException('Member not found');

    const avatarUrl = member.user.avatarUrl
      ? await this.storage.getPresignedDownloadUrl(member.user.avatarUrl)
      : null;

    return {
      userId: member.user.id,
      name: `${member.user.firstName} ${member.user.lastName}`.trim(),
      email: member.user.email,
      avatarUrl,
      role: member.role,
      status: member.status,
      joinedAt: member.joinedAt,
      lastActiveAt: member.lastActivityAt,
      ...engagementFromScore(member.activityScore),
      activityScore: member.activityScore,
      messageCount: member.messageCount,
      eventsAttendedCount: member.eventsAttendedCount,
      bannedAt: member.bannedAt,
      bannedBy: member.bannedBy,
      memberSince: member.user.createdAt,
    };
  }

  // ── Ban / Unban / Kick ─────────────────────────────────────────────────────

  async banMember(communityId: string, targetUserId: string, adminId: string) {
    const member = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId: targetUserId } },
      select: { status: true, role: true },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.role === CommunityRole.OWNER) throw new BadRequestException('Cannot ban the community owner');
    if (member.status === CommunityMemberStatus.BANNED) throw new BadRequestException('Member is already banned');

    const wasActive = member.status === CommunityMemberStatus.ACTIVE;

    await this.prisma.$transaction([
      this.prisma.communityMember.update({
        where: { communityId_userId: { communityId, userId: targetUserId } },
        data: { status: CommunityMemberStatus.BANNED, bannedAt: new Date(), bannedBy: adminId },
      }),
      ...(wasActive
        ? [this.prisma.community.update({ where: { id: communityId }, data: { memberCount: { decrement: 1 } } })]
        : []),
    ]);

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: AuditAction.COMMUNITY_MEMBER_BANNED,
      entityType: ENTITY_TYPE,
      entityId: targetUserId,
      metadata: { communityId },
    });

    return { success: true };
  }

  async unbanMember(communityId: string, targetUserId: string, adminId: string) {
    const member = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId: targetUserId } },
      select: { status: true },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.status !== CommunityMemberStatus.BANNED) throw new BadRequestException('Member is not banned');

    await this.prisma.$transaction([
      this.prisma.communityMember.update({
        where: { communityId_userId: { communityId, userId: targetUserId } },
        data: { status: CommunityMemberStatus.ACTIVE, bannedAt: null, bannedBy: null },
      }),
      this.prisma.community.update({ where: { id: communityId }, data: { memberCount: { increment: 1 } } }),
    ]);

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: AuditAction.COMMUNITY_MEMBER_UNBANNED,
      entityType: ENTITY_TYPE,
      entityId: targetUserId,
      metadata: { communityId },
    });

    return { success: true };
  }

  async kickMember(communityId: string, targetUserId: string, adminId: string) {
    const member = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId: targetUserId } },
      select: { status: true, role: true },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.role === CommunityRole.OWNER) throw new BadRequestException('Cannot remove the community owner');

    const wasActive = member.status === CommunityMemberStatus.ACTIVE;

    await this.prisma.$transaction([
      this.prisma.communityMember.update({
        where: { communityId_userId: { communityId, userId: targetUserId } },
        data: { status: CommunityMemberStatus.LEFT },
      }),
      ...(wasActive
        ? [this.prisma.community.update({ where: { id: communityId }, data: { memberCount: { decrement: 1 } } })]
        : []),
    ]);

    this.auditLogService.log({
      actorId: adminId,
      actorRole: 'ADMIN',
      action: AuditAction.COMMUNITY_MEMBER_KICKED,
      entityType: ENTITY_TYPE,
      entityId: targetUserId,
      metadata: { communityId },
    });

    return { success: true };
  }

  // ── Insights sidebar ───────────────────────────────────────────────────────

  async getMemberInsightsSidebar(communityId: string) {
    const cacheKey = `admin:member-insights:${communityId}`;
    const cached = await this.redis.get<unknown>(cacheKey);
    if (cached) return cached;

    const [activeCount, cityRows, interestRows, hostCount, powerCount] = await Promise.all([
      this.prisma.communityMember.count({
        where: { communityId, status: CommunityMemberStatus.ACTIVE },
      }),
      this.prisma.$queryRawUnsafe<{ city: string; count: number }[]>(
        `SELECT ap.city, COUNT(*)::int AS count
         FROM "community_members" cm
         JOIN "attendee_profiles" ap ON ap."userId" = cm."userId"
         WHERE cm."communityId" = $1 AND cm.status = 'ACTIVE' AND ap.city IS NOT NULL
         GROUP BY ap.city
         ORDER BY count DESC
         LIMIT 5`,
        communityId,
      ),
      this.prisma.$queryRawUnsafe<{ name: string; cnt: number }[]>(
        `SELECT i.name, COUNT(DISTINCT cm."userId")::int AS cnt
         FROM "community_members" cm
         JOIN "community_interests" ci ON ci."communityId" = cm."communityId"
         JOIN "interests" i ON i.id = ci."interestId"
         WHERE cm."communityId" = $1 AND cm.status = 'ACTIVE'
         GROUP BY i.name
         ORDER BY cnt DESC
         LIMIT 2`,
        communityId,
      ),
      this.prisma.communityMember.count({
        where: { communityId, status: CommunityMemberStatus.ACTIVE, role: CommunityRole.HOST },
      }),
      this.prisma.communityMember.count({
        where: { communityId, status: CommunityMemberStatus.ACTIVE, activityScore: { gte: 50 } },
      }),
    ]);

    const topCities = cityRows.map((r) => ({
      city: r.city,
      count: Number(r.count),
      pct: activeCount > 0 ? Math.round((Number(r.count) / activeCount) * 100) : 0,
    }));

    const memberSegments = [
      ...interestRows.map((r) => ({
        label: r.name,
        count: Number(r.cnt),
        pct: activeCount > 0 ? Math.round((Number(r.cnt) / activeCount) * 100) : 0,
      })),
      {
        label: 'Event Hosts',
        count: hostCount,
        pct: activeCount > 0 ? Math.round((hostCount / activeCount) * 100) : 0,
      },
      {
        label: 'Power Members',
        count: powerCount,
        pct: activeCount > 0 ? Math.round((powerCount / activeCount) * 100) : 0,
      },
    ];

    const result = { topCities, memberSegments };
    await this.redis.set(cacheKey, result, 120);
    return result;
  }

  // ── CSV export ─────────────────────────────────────────────────────────────

  async exportMembers(communityId: string): Promise<string> {
    const members = await this.prisma.communityMember.findMany({
      where: {
        communityId,
        status: { notIn: [CommunityMemberStatus.LEFT] },
      },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });

    const headers = [
      'firstName',
      'lastName',
      'email',
      'role',
      'status',
      'joinedAt',
      'lastActivityAt',
      'activityScore',
      'messageCount',
      'eventsAttendedCount',
    ];

    const rows = members.map((m) =>
      [
        m.user.firstName,
        m.user.lastName,
        m.user.email,
        m.role,
        m.status,
        m.joinedAt?.toISOString() ?? '',
        m.lastActivityAt?.toISOString() ?? '',
        m.activityScore,
        m.messageCount,
        m.eventsAttendedCount,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );

    return [headers.join(','), ...rows].join('\n');
  }

  // ── Invite generation ──────────────────────────────────────────────────────

  async generateInvite(communityId: string, adminId: string, dto: GenerateInviteDto) {
    const expiresAt = dto.expiresInDays
      ? new Date(Date.now() + dto.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const invite = await this.prisma.communityInvite.create({
      data: {
        communityId,
        createdBy: adminId,
        expiresAt,
        maxUses: dto.maxUses ?? null,
      },
    });

    return {
      token: invite.token,
      inviteUrl: `https://meetday.ai/join/${invite.token}`,
      expiresAt: invite.expiresAt,
      maxUses: invite.maxUses,
    };
  }

  // ── CSV import ─────────────────────────────────────────────────────────────

  async importMembers(communityId: string, adminId: string, csvBuffer: Buffer) {
    const lines = csvBuffer.toString('utf-8').split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return { imported: 0, skipped: 0, notFound: 0, errors: [] };

    const headerLine = lines[0].split(',');
    const emailIdx = headerLine.findIndex((h) => h.replace(/"/g, '').trim().toLowerCase() === 'email');
    if (emailIdx === -1) throw new BadRequestException('CSV must contain an "email" column');

    const dataRows = lines.slice(1);
    let imported = 0;
    let skipped = 0;
    let notFound = 0;
    const errors: string[] = [];

    for (const row of dataRows) {
      const cols = row.split(',');
      const email = cols[emailIdx]?.replace(/"/g, '').trim();
      if (!email) continue;

      try {
        const user = await this.prisma.user.findFirst({ where: { email }, select: { id: true } });
        if (!user) { notFound++; continue; }

        const existing = await this.prisma.communityMember.findUnique({
          where: { communityId_userId: { communityId, userId: user.id } },
          select: { status: true },
        });

        if (existing && existing.status === CommunityMemberStatus.ACTIVE) { skipped++; continue; }

        await this.prisma.communityMember.upsert({
          where: { communityId_userId: { communityId, userId: user.id } },
          create: { communityId, userId: user.id, status: CommunityMemberStatus.ACTIVE, joinedAt: new Date() },
          update: { status: CommunityMemberStatus.ACTIVE, joinedAt: new Date() },
        });

        imported++;
      } catch (e) {
        errors.push(`${email}: ${(e as Error).message}`);
      }
    }

    if (imported > 0) {
      await this.prisma.community.update({
        where: { id: communityId },
        data: { memberCount: { increment: imported } },
      });

      this.auditLogService.log({
        actorId: adminId,
        actorRole: 'ADMIN',
        action: AuditAction.COMMUNITY_MEMBER_ADDED,
        entityType: ENTITY_TYPE,
        entityId: communityId,
        metadata: { count: imported, source: 'csv_import' },
      });
    }

    return { imported, skipped, notFound, errors };
  }
}
