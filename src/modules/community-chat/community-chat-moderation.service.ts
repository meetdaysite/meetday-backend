import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, MessageReportStatus, ReportAction } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { CommunityPresenceService } from './community-presence.service';
import type { AddBlockedLinkDto } from './dto/add-blocked-link.dto';
import type { AddKeywordAlertDto } from './dto/add-keyword-alert.dto';
import type { IssueWarningDto } from './dto/issue-warning.dto';
import type { ListReportsQueryDto } from './dto/list-reports-query.dto';
import type { MuteUserDto } from './dto/mute-user.dto';
import type { ReportMessageDto } from './dto/report-message.dto';
import type { ResolveReportDto } from './dto/resolve-report.dto';

interface AnalyticsRow {
  day: string;
  messages: string;
  participants: string;
}

interface ReportAnalyticsRow {
  day: string;
  reports: string;
  approved: string;
}

const deltaPct = (current: number, prior: number) =>
  Math.round(((current - prior) / Math.max(prior, 1)) * 100);

@Injectable()
export class CommunityChatModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly presenceService: CommunityPresenceService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ─── Overview ─────────────────────────────────────────────────────────────

  async getAdminOverview(communityId: string) {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const [
      channelCount,
      presence,
      pendingReports,
      mutedCount,
      pinnedCount,
      channels,
      recentReports,
      recentPinned,
      recentMuted,
      msgRows,
      reportRows,
      keywordCount,
      linkCount,
      activeWarningCount,
    ] = await Promise.all([
      this.prisma.communityChannel.count({ where: { communityId, deletedAt: null } }),
      this.presenceService.getPresence(communityId),
      this.prisma.channelMessageReport.count({ where: { communityId, status: 'PENDING' } }),
      this.prisma.communityMutedUser.count({ where: { communityId } }),
      this.prisma.channelMessage.count({ where: { communityId, isPinned: true, deletedAt: null } }),

      this.prisma.communityChannel.findMany({
        where: { communityId, deletedAt: null },
        orderBy: { position: 'asc' },
        take: 5,
        select: { id: true, name: true, slug: true, isPublic: true, isDefault: true, position: true },
      }),

      this.prisma.channelMessageReport.findMany({
        where: { communityId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        take: 4,
        select: {
          id: true,
          createdAt: true,
          reason: true,
          message: { select: { id: true, content: true, channel: { select: { name: true } } } },
          reporter: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        },
      }),

      this.prisma.channelMessage.findMany({
        where: { communityId, isPinned: true, deletedAt: null },
        orderBy: { pinnedAt: 'desc' },
        take: 3,
        select: {
          id: true,
          content: true,
          pinnedAt: true,
          channel: { select: { name: true } },
          pinnedByUser: { select: { firstName: true, lastName: true } },
        },
      }),

      this.prisma.communityMutedUser.findMany({
        where: { communityId },
        orderBy: { mutedAt: 'desc' },
        take: 3,
        distinct: ['userId'],
        select: { id: true, mutedAt: true, user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
      }),

      this.prisma.$queryRawUnsafe<AnalyticsRow[]>(
        `SELECT
           DATE("createdAt" AT TIME ZONE 'UTC')::text AS day,
           COUNT(*)::text                             AS messages,
           COUNT(DISTINCT "senderId")::text           AS participants
         FROM "channel_messages"
         WHERE "communityId" = $1
           AND "createdAt" >= $2
           AND "deletedAt" IS NULL
         GROUP BY 1 ORDER BY 1 ASC`,
        communityId,
        fourteenDaysAgo,
      ),

      this.prisma.$queryRawUnsafe<ReportAnalyticsRow[]>(
        `SELECT
           DATE("createdAt" AT TIME ZONE 'UTC')::text                       AS day,
           COUNT(*)::text                                                    AS reports,
           COUNT(*) FILTER (WHERE action = 'APPROVED')::text                AS approved
         FROM "channel_message_reports"
         WHERE "communityId" = $1
           AND "createdAt" >= $2
         GROUP BY 1 ORDER BY 1 ASC`,
        communityId,
        fourteenDaysAgo,
      ),

      this.prisma.chatKeywordAlert.count({ where: { communityId } }),
      this.prisma.chatBlockedLink.count({ where: { communityId } }),
      this.prisma.chatContentWarning.count({
        where: {
          communityId,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      }),
    ]);

    // Build per-user mute channel counts for the recent muted list
    const recentMutedUserIds = recentMuted.map((m) => m.user.id);
    const muteCounts = recentMutedUserIds.length > 0
      ? await this.prisma.communityMutedUser.groupBy({
          by: ['userId'],
          where: { communityId, userId: { in: recentMutedUserIds } },
          _count: { id: true },
        })
      : [];
    const muteCountMap = new Map(muteCounts.map((r) => [r.userId, r._count.id]));

    // Sign reporter avatars
    const reportedMessages = await Promise.all(
      recentReports.map(async (r) => {
        const avatarKey = r.reporter.avatarUrl;
        const avatarUrl = avatarKey ? await this.storage.getPresignedDownloadUrl(avatarKey) : null;
        return {
          reportId: r.id,
          reason: r.reason,
          createdAt: r.createdAt,
          message: {
            id: r.message.id,
            content: r.message.content.slice(0, 200),
            channelName: r.message.channel.name,
          },
          reporter: { ...r.reporter, avatarUrl },
        };
      }),
    );

    // Sign muted user avatars
    const mutedUsers = await Promise.all(
      recentMuted.map(async (m) => {
        const avatarKey = m.user.avatarUrl;
        const avatarUrl = avatarKey ? await this.storage.getPresignedDownloadUrl(avatarKey) : null;
        return {
          muteId: m.id,
          mutedAt: m.mutedAt,
          channelCount: muteCountMap.get(m.user.id) ?? 1,
          user: { ...m.user, avatarUrl },
        };
      }),
    );

    // Build 7-day sparklines from 14-day raw rows
    const today = new Date();
    const last7 = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - (6 - i));
      return d.toISOString().slice(0, 10);
    });
    const prior7 = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - (13 - i));
      return d.toISOString().slice(0, 10);
    });

    const msgMap = new Map(msgRows.map((r) => [r.day, r]));
    const repMap = new Map(reportRows.map((r) => [r.day, r]));

    const msgSparkline = last7.map((d) => Number(msgMap.get(d)?.messages ?? 0));
    const partSparkline = last7.map((d) => Number(msgMap.get(d)?.participants ?? 0));
    const repSparkline = last7.map((d) => Number(repMap.get(d)?.reports ?? 0));
    const approvedSparkline = last7.map((d) => Number(repMap.get(d)?.approved ?? 0));

    const sum = (arr: string[]) => arr.reduce((a, d) => a + Number(msgMap.get(d)?.messages ?? 0), 0);
    const sumPart = (arr: string[]) => arr.reduce((a, d) => a + Number(msgMap.get(d)?.participants ?? 0), 0);
    const sumRep = (arr: string[]) => arr.reduce((a, d) => a + Number(repMap.get(d)?.reports ?? 0), 0);
    const sumApproved = (arr: string[]) => arr.reduce((a, d) => a + Number(repMap.get(d)?.approved ?? 0), 0);

    const msgCurrent = sum(last7);
    const msgPrior = sum(prior7);
    const partCurrent = sumPart(last7);
    const partPrior = sumPart(prior7);
    const repCurrent = sumRep(last7);
    const repPrior = sumRep(prior7);
    const appCurrent = sumApproved(last7);
    const appPrior = sumApproved(prior7);

    return {
      stats: {
        totalChannels: channelCount,
        onlineNow: presence.onlineCount,
        pendingReports,
        mutedUsers: mutedCount,
        pinnedMessages: pinnedCount,
      },
      channels: channels.map((c) => ({ ...c, onlineCount: presence.onlineCount })),
      reportedMessages,
      pinnedMessages: recentPinned.map((m) => ({
        id: m.id,
        content: m.content.slice(0, 200),
        channelName: m.channel.name,
        pinnedByName: m.pinnedByUser
          ? `${m.pinnedByUser.firstName} ${m.pinnedByUser.lastName}`
          : null,
        pinnedAt: m.pinnedAt,
      })),
      mutedUsers,
      sidebar: {
        overview7d: {
          messagesSent: { value: msgCurrent, deltaPct: deltaPct(msgCurrent, msgPrior), sparkline: msgSparkline },
          activeParticipants: { value: partCurrent, deltaPct: deltaPct(partCurrent, partPrior), sparkline: partSparkline },
          reportsReceived: { value: repCurrent, deltaPct: deltaPct(repCurrent, repPrior), sparkline: repSparkline },
          messagesApproved: { value: appCurrent, deltaPct: deltaPct(appCurrent, appPrior), sparkline: approvedSparkline },
        },
        moderationTools: {
          pendingReports,
          keywordAlerts: keywordCount,
          blockedLinks: linkCount,
          activeWarnings: activeWarningCount,
        },
      },
    };
  }

  // ─── Reports ──────────────────────────────────────────────────────────────

  async listReports(communityId: string, query: ListReportsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const status = query.status ?? MessageReportStatus.PENDING;

    const [reports, total] = await Promise.all([
      this.prisma.channelMessageReport.findMany({
        where: { communityId, status },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          reason: true,
          body: true,
          status: true,
          action: true,
          createdAt: true,
          resolvedAt: true,
          message: {
            select: {
              id: true,
              content: true,
              createdAt: true,
              channel: { select: { id: true, name: true } },
              sender: { select: { id: true, firstName: true, lastName: true } },
            },
          },
          reporter: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          resolver: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.channelMessageReport.count({ where: { communityId, status } }),
    ]);

    return { reports, total, page, limit };
  }

  async resolveReport(reportId: string, communityId: string, actorId: string, dto: ResolveReportDto) {
    const report = await this.prisma.channelMessageReport.findFirst({
      where: { id: reportId, communityId, status: 'PENDING' },
      select: { id: true, messageId: true },
    });
    if (!report) throw new NotFoundException('Report not found or already resolved');

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.channelMessageReport.update({
        where: { id: reportId },
        data: {
          status: 'RESOLVED',
          resolvedBy: actorId,
          resolvedAt: now,
          action: dto.action,
        },
      });

      if (dto.action === ReportAction.REMOVED) {
        await tx.channelMessage.update({
          where: { id: report.messageId },
          data: { deletedAt: now },
        });
      }
    });

    const action =
      dto.action === ReportAction.REMOVED
        ? AuditAction.CHAT_MESSAGE_DELETED_BY_MOD
        : AuditAction.CHAT_REPORT_RESOLVED;

    this.auditLog.log({
      actorId,
      action,
      entityType: 'ChannelMessageReport',
      entityId: reportId,
      metadata: { communityId, reportId, messageId: report.messageId, resolveAction: dto.action },
    });

    return { success: true };
  }

  // ─── Pinned (community-wide) ──────────────────────────────────────────────

  async listPinnedCommunityWide(communityId: string, page = 1, limit = 20) {
    const [messages, total] = await Promise.all([
      this.prisma.channelMessage.findMany({
        where: { communityId, isPinned: true, deletedAt: null },
        orderBy: { pinnedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          content: true,
          pinnedAt: true,
          channel: { select: { id: true, name: true } },
          sender: { select: { id: true, firstName: true, lastName: true } },
          pinnedByUser: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.channelMessage.count({ where: { communityId, isPinned: true, deletedAt: null } }),
    ]);
    return { messages, total, page, limit };
  }

  // ─── Muted Users ──────────────────────────────────────────────────────────

  async listMutedUsers(communityId: string, page = 1, limit = 20) {
    const now = new Date();

    const [records, total] = await Promise.all([
      this.prisma.communityMutedUser.findMany({
        where: { communityId },
        orderBy: { mutedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          channelId: true,
          mutedAt: true,
          mutedUntil: true,
          reason: true,
          user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          channel: { select: { name: true } },
          mutedByUser: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.communityMutedUser.count({ where: { communityId } }),
    ]);

    const mutes = await Promise.all(
      records.map(async (r) => {
        const avatarKey = r.user.avatarUrl;
        const avatarUrl = avatarKey ? await this.storage.getPresignedDownloadUrl(avatarKey) : null;
        return {
          ...r,
          isActive: !r.mutedUntil || r.mutedUntil > now,
          user: { ...r.user, avatarUrl },
        };
      }),
    );

    return { mutes, total, page, limit };
  }

  async muteUser(communityId: string, actorId: string, dto: MuteUserDto) {
    const existing = await this.prisma.communityMutedUser.findFirst({
      where: {
        communityId,
        userId: dto.userId,
        channelId: dto.channelId ?? null,
      },
      select: { id: true },
    });
    if (existing) throw new ConflictException('User is already muted in this scope');

    const mute = await this.prisma.communityMutedUser.create({
      data: {
        communityId,
        userId: dto.userId,
        channelId: dto.channelId ?? null,
        mutedBy: actorId,
        reason: dto.reason,
        mutedUntil: dto.mutedUntil ? new Date(dto.mutedUntil) : null,
      },
    });

    this.auditLog.log({
      actorId,
      action: AuditAction.CHAT_USER_MUTED,
      entityType: 'CommunityMutedUser',
      entityId: mute.id,
      metadata: { communityId, targetUserId: dto.userId, channelId: dto.channelId ?? null },
    });

    return mute;
  }

  async unmuteUser(communityId: string, userId: string, actorId: string, channelId?: string) {
    const where = channelId
      ? { communityId, userId, channelId }
      : { communityId, userId };

    const deleted = await this.prisma.communityMutedUser.deleteMany({ where });
    if (deleted.count === 0) throw new NotFoundException('No active mute found');

    this.auditLog.log({
      actorId,
      action: AuditAction.CHAT_USER_UNMUTED,
      entityType: 'CommunityMutedUser',
      entityId: userId,
      metadata: { communityId, targetUserId: userId, channelId: channelId ?? null },
    });

    return { success: true };
  }

  // ─── Keyword Alerts ───────────────────────────────────────────────────────

  async listKeywords(communityId: string) {
    return this.prisma.chatKeywordAlert.findMany({
      where: { communityId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, keyword: true, channelId: true, createdAt: true, channel: { select: { name: true } } },
    });
  }

  async addKeyword(communityId: string, actorId: string, dto: AddKeywordAlertDto) {
    const keyword = await this.prisma.chatKeywordAlert.create({
      data: {
        communityId,
        keyword: dto.keyword.toLowerCase().trim(),
        channelId: dto.channelId ?? null,
        createdBy: actorId,
      },
    });

    this.auditLog.log({
      actorId,
      action: AuditAction.CHAT_KEYWORD_ADDED,
      entityType: 'ChatKeywordAlert',
      entityId: keyword.id,
      metadata: { communityId, keyword: dto.keyword },
    });

    return keyword;
  }

  async deleteKeyword(keywordId: string, communityId: string, actorId: string) {
    const kw = await this.prisma.chatKeywordAlert.findFirst({
      where: { id: keywordId, communityId },
      select: { id: true, keyword: true },
    });
    if (!kw) throw new NotFoundException('Keyword alert not found');

    await this.prisma.chatKeywordAlert.delete({ where: { id: keywordId } });

    this.auditLog.log({
      actorId,
      action: AuditAction.CHAT_KEYWORD_REMOVED,
      entityType: 'ChatKeywordAlert',
      entityId: keywordId,
      metadata: { communityId, keyword: kw.keyword },
    });

    return { success: true };
  }

  // ─── Blocked Links ────────────────────────────────────────────────────────

  async listBlockedLinks(communityId: string) {
    return this.prisma.chatBlockedLink.findMany({
      where: { communityId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, pattern: true, createdAt: true, creator: { select: { firstName: true, lastName: true } } },
    });
  }

  async addBlockedLink(communityId: string, actorId: string, dto: AddBlockedLinkDto) {
    const link = await this.prisma.chatBlockedLink.create({
      data: { communityId, pattern: dto.pattern.toLowerCase().trim(), createdBy: actorId },
    });

    this.auditLog.log({
      actorId,
      action: AuditAction.CHAT_LINK_BLOCKED,
      entityType: 'ChatBlockedLink',
      entityId: link.id,
      metadata: { communityId, pattern: dto.pattern },
    });

    return link;
  }

  async deleteBlockedLink(linkId: string, communityId: string, actorId: string) {
    const link = await this.prisma.chatBlockedLink.findFirst({
      where: { id: linkId, communityId },
      select: { id: true, pattern: true },
    });
    if (!link) throw new NotFoundException('Blocked link not found');

    await this.prisma.chatBlockedLink.delete({ where: { id: linkId } });

    this.auditLog.log({
      actorId,
      action: AuditAction.CHAT_LINK_UNBLOCKED,
      entityType: 'ChatBlockedLink',
      entityId: linkId,
      metadata: { communityId, pattern: link.pattern },
    });

    return { success: true };
  }

  // ─── Content Warnings ─────────────────────────────────────────────────────

  async listWarnings(communityId: string, page = 1, limit = 20) {
    const now = new Date();
    const [warnings, total] = await Promise.all([
      this.prisma.chatContentWarning.findMany({
        where: { communityId },
        orderBy: { issuedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          reason: true,
          issuedAt: true,
          expiresAt: true,
          user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          issuedByUser: { select: { id: true, firstName: true, lastName: true } },
          message: { select: { id: true, content: true } },
        },
      }),
      this.prisma.chatContentWarning.count({ where: { communityId } }),
    ]);

    const result = await Promise.all(
      warnings.map(async (w) => {
        const avatarKey = w.user.avatarUrl;
        const avatarUrl = avatarKey ? await this.storage.getPresignedDownloadUrl(avatarKey) : null;
        return {
          ...w,
          isActive: !w.expiresAt || w.expiresAt > now,
          user: { ...w.user, avatarUrl },
        };
      }),
    );

    return { warnings: result, total, page, limit };
  }

  async issueWarning(communityId: string, actorId: string, dto: IssueWarningDto) {
    const warning = await this.prisma.chatContentWarning.create({
      data: {
        communityId,
        userId: dto.userId,
        messageId: dto.messageId ?? null,
        reason: dto.reason,
        issuedBy: actorId,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });

    this.auditLog.log({
      actorId,
      action: AuditAction.CHAT_WARNING_ISSUED,
      entityType: 'ChatContentWarning',
      entityId: warning.id,
      metadata: { communityId, targetUserId: dto.userId },
    });

    return warning;
  }

  async revokeWarning(warningId: string, communityId: string, actorId: string) {
    const warning = await this.prisma.chatContentWarning.findFirst({
      where: { id: warningId, communityId },
      select: { id: true, userId: true },
    });
    if (!warning) throw new NotFoundException('Warning not found');

    await this.prisma.chatContentWarning.delete({ where: { id: warningId } });

    this.auditLog.log({
      actorId,
      action: AuditAction.CHAT_WARNING_REVOKED,
      entityType: 'ChatContentWarning',
      entityId: warningId,
      metadata: { communityId, targetUserId: warning.userId },
    });

    return { success: true };
  }

  // ─── User-facing: submit report ───────────────────────────────────────────

  async submitReport(
    communityId: string,
    channelId: string,
    messageId: string,
    reporterId: string,
    dto: ReportMessageDto,
  ) {
    const message = await this.prisma.channelMessage.findFirst({
      where: { id: messageId, channelId, deletedAt: null },
      select: { id: true },
    });
    if (!message) throw new NotFoundException('Message not found');

    const existing = await this.prisma.channelMessageReport.findUnique({
      where: { messageId_reporterId: { messageId, reporterId } },
      select: { id: true },
    });
    if (existing) throw new ConflictException('You have already reported this message');

    return this.prisma.channelMessageReport.create({
      data: {
        messageId,
        channelId,
        communityId,
        reporterId,
        reason: dto.reason,
        body: dto.body,
      },
      select: { id: true, status: true, createdAt: true },
    });
  }
}
