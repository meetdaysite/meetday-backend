import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';

export type TeamMemberView = {
  id: string;
  name: string | null;
  email: string;
  role: 'OWNER' | 'MEMBER';
  status: 'PENDING' | 'ACTIVE';
};

// Resolves "which Brand/Host(Community) profile does this user act on behalf of" — either as
// the original owner (BrandProfile.userId / HostProfile.userId) or as a full-access team member
// (BrandTeamMember / HostTeamMember, status=ACTIVE). Every dashboard/API entry point that used
// to do `prisma.hostProfile.findUnique({ where: { userId } })` should instead resolve through
// here, so invited team members get identical access to the owner.
@Injectable()
export class TeamAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @InjectQueue('mail') private readonly mailQueue: Queue,
  ) {}

  // ── Resolution (owner OR active member) ───────────────────────────────────

  async getHostProfileIds(userId: string): Promise<string[]> {
    const [owned, memberships] = await Promise.all([
      this.prisma.hostProfile.findUnique({ where: { userId }, select: { id: true } }),
      this.prisma.hostTeamMember.findMany({ where: { userId, status: 'ACTIVE' }, select: { hostProfileId: true } }),
    ]);
    const ids = new Set<string>();
    if (owned) ids.add(owned.id);
    memberships.forEach((m) => ids.add(m.hostProfileId));
    return Array.from(ids);
  }

  async getBrandProfileIds(userId: string): Promise<string[]> {
    const [owned, memberships] = await Promise.all([
      this.prisma.brandProfile.findUnique({ where: { userId }, select: { id: true } }),
      this.prisma.brandTeamMember.findMany({ where: { userId, status: 'ACTIVE' }, select: { brandProfileId: true } }),
    ]);
    const ids = new Set<string>();
    if (owned) ids.add(owned.id);
    memberships.forEach((m) => ids.add(m.brandProfileId));
    return Array.from(ids);
  }

  async resolveHostProfileId(userId: string): Promise<string> {
    const [id] = await this.getHostProfileIds(userId);
    if (!id) throw new NotFoundException('Host profile not found');
    return id;
  }

  async resolveBrandProfileId(userId: string): Promise<string> {
    const [id] = await this.getBrandProfileIds(userId);
    if (!id) throw new NotFoundException('Brand profile not found');
    return id;
  }

  // ── Invite (any owner/member can invite a new member by email) ────────────

  async inviteHostTeamMember(hostProfileId: string, email: string, invitedByUserId: string) {
    const normalizedEmail = email.toLowerCase().trim();

    const [hostProfile, inviter] = await Promise.all([
      this.prisma.hostProfile.findUnique({
        where: { id: hostProfileId },
        select: { communityName: true, displayName: true, user: { select: { email: true } } },
      }),
      this.prisma.user.findUnique({ where: { id: invitedByUserId }, select: { firstName: true, lastName: true } }),
    ]);
    if (!hostProfile) throw new NotFoundException('Host profile not found');
    if (hostProfile.user.email?.toLowerCase() === normalizedEmail) {
      throw new ConflictException('This is already the owner\'s email');
    }

    const existing = await this.prisma.hostTeamMember.findUnique({
      where: { hostProfileId_email: { hostProfileId, email: normalizedEmail } },
    });
    if (existing?.status === 'ACTIVE') {
      throw new ConflictException('This email is already a member');
    }

    const member = await this.prisma.hostTeamMember.upsert({
      where: { hostProfileId_email: { hostProfileId, email: normalizedEmail } },
      create: { hostProfileId, email: normalizedEmail, invitedBy: invitedByUserId, status: 'PENDING' },
      update: { invitedBy: invitedByUserId, status: 'PENDING', userId: null, joinedAt: null },
    });

    const accountName = hostProfile.communityName || hostProfile.displayName || 'the community';
    const inviterName = `${inviter?.firstName ?? ''} ${inviter?.lastName ?? ''}`.trim() || 'A teammate';
    const frontendUrl = this.configService.get<string>('frontendUrl');
    void this.mailQueue
      .add('team-invite', {
        to: normalizedEmail,
        inviterName,
        accountName,
        accountTypeLabel: 'Community',
        signupUrl: `${frontendUrl}/community/signup`,
      })
      .catch(() => {});

    return member;
  }

  async inviteBrandTeamMember(brandProfileId: string, email: string, invitedByUserId: string) {
    const normalizedEmail = email.toLowerCase().trim();

    const [brandProfile, inviter] = await Promise.all([
      this.prisma.brandProfile.findUnique({
        where: { id: brandProfileId },
        select: { brandName: true, user: { select: { email: true } } },
      }),
      this.prisma.user.findUnique({ where: { id: invitedByUserId }, select: { firstName: true, lastName: true } }),
    ]);
    if (!brandProfile) throw new NotFoundException('Brand profile not found');
    if (brandProfile.user.email?.toLowerCase() === normalizedEmail) {
      throw new ConflictException('This is already the owner\'s email');
    }

    const existing = await this.prisma.brandTeamMember.findUnique({
      where: { brandProfileId_email: { brandProfileId, email: normalizedEmail } },
    });
    if (existing?.status === 'ACTIVE') {
      throw new ConflictException('This email is already a member');
    }

    const member = await this.prisma.brandTeamMember.upsert({
      where: { brandProfileId_email: { brandProfileId, email: normalizedEmail } },
      create: { brandProfileId, email: normalizedEmail, invitedBy: invitedByUserId, status: 'PENDING' },
      update: { invitedBy: invitedByUserId, status: 'PENDING', userId: null, joinedAt: null },
    });

    const inviterName = `${inviter?.firstName ?? ''} ${inviter?.lastName ?? ''}`.trim() || 'A teammate';
    const frontendUrl = this.configService.get<string>('frontendUrl');
    void this.mailQueue
      .add('team-invite', {
        to: normalizedEmail,
        inviterName,
        accountName: brandProfile.brandName || 'the brand',
        accountTypeLabel: 'Brand',
        signupUrl: `${frontendUrl}/brand/signup`,
      })
      .catch(() => {});

    return member;
  }

  // ── Remove (any owner/member can remove a PENDING or ACTIVE member) ───────
  // Hard-deletes the row so the removed email can no longer auto-join via a stale invite
  // link — we can't unsend the invite mail, but the signup link stops working afterward.

  async removeHostTeamMember(hostProfileId: string, memberId: string): Promise<void> {
    const member = await this.prisma.hostTeamMember.findUnique({ where: { id: memberId } });
    if (!member || member.hostProfileId !== hostProfileId) {
      throw new NotFoundException('Team member not found');
    }
    await this.prisma.hostTeamMember.delete({ where: { id: memberId } });
  }

  async removeBrandTeamMember(brandProfileId: string, memberId: string): Promise<void> {
    const member = await this.prisma.brandTeamMember.findUnique({ where: { id: memberId } });
    if (!member || member.brandProfileId !== brandProfileId) {
      throw new NotFoundException('Team member not found');
    }
    await this.prisma.brandTeamMember.delete({ where: { id: memberId } });
  }

  // ── Members list (name + email of everyone, visible to any member) ────────

  async listHostTeamMembers(hostProfileId: string): Promise<TeamMemberView[]> {
    const [hostProfile, members] = await Promise.all([
      this.prisma.hostProfile.findUnique({
        where: { id: hostProfileId },
        select: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
      }),
      this.prisma.hostTeamMember.findMany({
        where: { hostProfileId },
        include: { user: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    if (!hostProfile) throw new NotFoundException('Host profile not found');

    const owner: TeamMemberView = {
      id: hostProfile.user.id,
      name: `${hostProfile.user.firstName} ${hostProfile.user.lastName}`.trim() || null,
      email: hostProfile.user.email ?? '',
      role: 'OWNER',
      status: 'ACTIVE',
    };
    return [
      owner,
      ...members.map((m) => ({
        id: m.id,
        name: m.user ? `${m.user.firstName} ${m.user.lastName}`.trim() || null : null,
        email: m.email,
        role: 'MEMBER' as const,
        status: m.status,
      })),
    ];
  }

  async listBrandTeamMembers(brandProfileId: string): Promise<TeamMemberView[]> {
    const [brandProfile, members] = await Promise.all([
      this.prisma.brandProfile.findUnique({
        where: { id: brandProfileId },
        select: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
      }),
      this.prisma.brandTeamMember.findMany({
        where: { brandProfileId },
        include: { user: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    if (!brandProfile) throw new NotFoundException('Brand profile not found');

    const owner: TeamMemberView = {
      id: brandProfile.user.id,
      name: `${brandProfile.user.firstName} ${brandProfile.user.lastName}`.trim() || null,
      email: brandProfile.user.email ?? '',
      role: 'OWNER',
      status: 'ACTIVE',
    };
    return [
      owner,
      ...members.map((m) => ({
        id: m.id,
        name: m.user ? `${m.user.firstName} ${m.user.lastName}`.trim() || null : null,
        email: m.email,
        role: 'MEMBER' as const,
        status: m.status,
      })),
    ];
  }

  // ── Email match on signup (called from AuthService.register()) ────────────

  async matchPendingHostInvite(email: string) {
    return this.prisma.hostTeamMember.findFirst({
      where: { email: email.toLowerCase().trim(), status: 'PENDING' },
      select: { id: true, hostProfileId: true },
    });
  }

  async matchPendingBrandInvite(email: string) {
    return this.prisma.brandTeamMember.findFirst({
      where: { email: email.toLowerCase().trim(), status: 'PENDING' },
      select: { id: true, brandProfileId: true },
    });
  }

  // Links an ALREADY-registered User (e.g. someone who already has a plain USER or admin
  // account under this email) to a pending invite — used when register() finds an `existing`
  // user row instead of creating a brand-new one.
  async attachUserToHostInvite(inviteId: string, userId: string): Promise<void> {
    await this.prisma.hostTeamMember.update({
      where: { id: inviteId },
      data: { userId, status: 'ACTIVE', joinedAt: new Date() },
    });
  }

  async attachUserToBrandInvite(inviteId: string, userId: string): Promise<void> {
    await this.prisma.brandTeamMember.update({
      where: { id: inviteId },
      data: { userId, status: 'ACTIVE', joinedAt: new Date() },
    });
  }

  // Lightweight pre-registration check (email + accountName only) — used by the frontend
  // onboarding pages to skip the full "set up your profile" form when this signup will
  // actually just join an existing team instead of creating a new profile. `hostType` is
  // also returned so the UI can skip the "Individual vs Business" step too (auto-inherited
  // from the community being joined).
  async checkPendingHostInvite(
    email: string,
  ): Promise<{ matched: boolean; accountName?: string; hostType?: 'INDIVIDUAL' | 'BUSINESS' }> {
    const invite = await this.matchPendingHostInvite(email);
    if (!invite) return { matched: false };
    const hostProfile = await this.prisma.hostProfile.findUnique({
      where: { id: invite.hostProfileId },
      select: { communityName: true, displayName: true, hostType: true },
    });
    return {
      matched: true,
      accountName: hostProfile?.communityName || hostProfile?.displayName || undefined,
      hostType: hostProfile?.hostType ?? undefined,
    };
  }

  async checkPendingBrandInvite(email: string): Promise<{ matched: boolean; accountName?: string }> {
    const invite = await this.matchPendingBrandInvite(email);
    if (!invite) return { matched: false };
    const brandProfile = await this.prisma.brandProfile.findUnique({
      where: { id: invite.brandProfileId },
      select: { brandName: true },
    });
    return { matched: true, accountName: brandProfile?.brandName };
  }
}
