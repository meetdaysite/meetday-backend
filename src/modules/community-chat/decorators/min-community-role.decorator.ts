import { SetMetadata } from '@nestjs/common';
import { CommunityRole } from '@prisma/client';

export const MIN_COMMUNITY_ROLE_KEY = 'minCommunityRole';
export const MinCommunityRole = (role: CommunityRole) =>
  SetMetadata(MIN_COMMUNITY_ROLE_KEY, role);
