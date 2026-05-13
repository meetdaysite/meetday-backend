import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Auth')
@ApiBearerAuth('firebase-token')
@ApiUnauthorizedResponse({ description: 'Missing or invalid Firebase JWT' })
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register after Firebase signup',
    description:
      'Called once by the client immediately after a successful Firebase signup. ' +
      'Identity fields (uid, email, phone, displayName, avatarUrl) are extracted from the verified JWT — never pass them in the body.\n\n' +
      '**Supported providers:**\n' +
      '- `password` (email/password) — email from token, firstName + lastName required in body\n' +
      '- `phone` — phone from token, firstName + lastName required in body; **for HOST registration, `email` must also be provided in the body** (phone tokens carry no email, but hosts need one for transactional mail)\n' +
      '- `google.com` / `apple.com` — email + displayName from token, firstName + lastName optional (token name used as fallback)\n\n' +
      '**accountType: USER** — Creates a standard attendee account. ' +
      'Optionally accepts `vibeType` and `socialStyle` to seed the attendee profile at registration time — ' +
      'useful for onboarding flows that ask these questions upfront. ' +
      'All other profile fields (username, bio, city, etc.) are set later via `POST /attendee/profile`.\n\n' +
      '**accountType: HOST** — Creates the user with the HOST role and atomically creates a ' +
      'HostProfile (kycStatus: NOT_SUBMITTED, approvalStatus: PENDING). ' +
      '`categoryIds` and `hostType` are required. `email` is required when the Firebase token carries no email (phone-OTP sign-ups).',
  })
  @ApiBody({
    type: RegisterDto,
    examples: {
      registerAsUser: {
        summary: 'Register as a regular user (phone OTP)',
        value: {
          firstName: 'Rahul',
          lastName: 'Sharma',
          phone: '+919876543210',
          accountType: 'USER',
          vibeType: 'HERE_TO_CONNECT',
          socialStyle: 'OPEN_TO_MEETING',
        },
      },
      registerAsHost: {
        summary: 'Register as a host (phone-OTP sign-up)',
        value: {
          firstName: 'Priya',
          lastName: 'Nair',
          phone: '+919876543211',
          email: 'priya@example.com',
          accountType: 'HOST',
          hostType: 'INDIVIDUAL',
          displayName: 'Mumbai Walks by Priya',
          legalName: 'Priya Nair',
          pan: 'ABCDE1234F',
          categoryIds: ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
          hostBio: 'I run weekly photography walks across Mumbai exploring hidden heritage.',
          tagline: 'Discover Mumbai through a lens',
          languages: ['English', 'Hindi', 'Marathi'],
          yearsOfExperience: 3,
          totalEventsPreviouslyHosted: 15,
          operatingCities: ['Mumbai', 'Pune'],
          socialLinks: {
            instagram: 'https://instagram.com/mumbaiwalks',
          },
          address: {
            addressLine1: '12, Linking Road',
            addressLine2: 'Bandra West',
            city: 'Mumbai',
            state: 'Maharashtra',
            pincode: '400050',
          },
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'User registered. For HOST accountType, response includes the created hostProfile.',
    schema: {
      examples: {
        userResponse: {
          summary: 'USER registration response',
          value: {
            success: true,
            timestamp: '2026-04-08T10:00:00.000Z',
            data: {
              id: 'user-uuid',
              email: null,
              phone: '+919876543210',
              firstName: 'Rahul',
              lastName: 'Sharma',
              avatarUrl: null,
              isActive: true,
              role: { name: 'USER' },
              createdAt: '2026-04-08T10:00:00.000Z',
            },
          },
        },
        hostResponse: {
          summary: 'HOST registration response',
          value: {
            success: true,
            timestamp: '2026-04-08T10:00:00.000Z',
            data: {
              id: 'user-uuid',
              email: 'priya.nair@example.com',
              firstName: 'Priya',
              lastName: 'Nair',
              phone: '+919876543211',
              avatarUrl: null,
              isActive: true,
              role: { name: 'HOST' },
              createdAt: '2026-04-08T10:00:00.000Z',
              hostProfile: {
                id: 'hp-uuid',
                hostType: 'INDIVIDUAL',
                displayName: 'Mumbai Walks by Priya',
                legalName: 'Priya Nair',
                kycStatus: 'NOT_SUBMITTED',
                approvalStatus: 'PENDING',
                currentPlan: 'DISCOVER',
                operatingCities: ['Mumbai', 'Pune'],
                address: {
                  addressLine1: '12, Linking Road',
                  addressLine2: 'Bandra West',
                  city: 'Mumbai',
                  state: 'Maharashtra',
                  pincode: '400050',
                  country: 'India',
                },
                categories: [{ category: { id: 'cat-uuid', name: 'Outdoor Adventures' } }],
              },
            },
          },
        },
      },
    },
  })
  @ApiConflictResponse({ description: 'Firebase UID is already registered.' })
  register(
    @GetUser() tokenUser: {
      uid: string;
      email?: string;
      phone?: string;
      displayName?: string;
      avatarUrl?: string;
      provider: string;
    },
    @Body() dto: RegisterDto,
  ) {
    return this.authService.register(tokenUser, dto);
  }

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Activate account after password reset',
    description:
      'Called by an invited admin immediately after they have set their password via the Firebase reset link. ' +
      'No request body required — a valid Firebase JWT is sufficient proof that the password was set. ' +
      'Sets `isActive=true` and `mustCompleteProfile=false` so the account becomes fully operational. ' +
      'No `RolesGuard` is applied — the account is inactive at this point and would otherwise be blocked.',
  })
  @ApiOkResponse({
    description: 'Account activated.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-13T10:00:00.000Z',
        data: {
          id: 'user-uuid',
          email: 'citymanager@meetday.in',
          firstName: 'Rahul',
          lastName: 'Sharma',
          isActive: true,
          mustCompleteProfile: false,
          role: { name: 'CITY_ADMIN' },
          updatedAt: '2026-04-13T10:05:00.000Z',
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'No user record found for this Firebase UID.' })
  @ApiBadRequestResponse({ description: 'Account is already active.' })
  activate(@GetUser('uid') firebaseUid: string) {
    return this.authService.activateAccount(firebaseUid);
  }

  @Post('complete-profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete profile after admin invite',
    description:
      'Called by an invited admin after they have set their password via the Firebase reset link. ' +
      'Fills in `firstName`, `lastName`, and optionally `phone`, then sets `isActive=true` and ' +
      '`mustCompleteProfile=false` so the account becomes fully operational.\n\n' +
      'No `RolesGuard` is applied here — the invited admin\'s `isActive` is `false` at this point, ' +
      'which would otherwise block them. Only a valid Firebase JWT is required.',
  })
  @ApiBody({
    type: CompleteProfileDto,
    examples: {
      default: {
        summary: 'Admin completing profile',
        value: { firstName: 'Aishik', lastName: 'Sikdar', phone: '+919876543210' },
      },
    },
  })
  @ApiOkResponse({
    description: 'Profile completed. Account is now active.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-08T10:00:00.000Z',
        data: {
          id: 'user-uuid',
          email: 'citymanager@meetday.in',
          phone: '+919876543210',
          firstName: 'Aishik',
          lastName: 'Sikdar',
          avatarUrl: null,
          isActive: true,
          mustCompleteProfile: false,
          role: { name: 'CITY_ADMIN' },
          createdAt: '2026-04-08T10:00:00.000Z',
          updatedAt: '2026-04-08T10:05:00.000Z',
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'No user record found for this Firebase UID.' })
  @ApiBadRequestResponse({ description: 'Profile is already complete.' })
  completeProfile(
    @GetUser('uid') firebaseUid: string,
    @Body() dto: CompleteProfileDto,
  ) {
    return this.authService.completeProfile(firebaseUid, dto);
  }

  @Get('me')
  @ApiOperation({
    summary: 'Get current user profile',
    description:
      'Returns the full profile of the authenticated user including their role and user profile. ' +
      'Useful for bootstrapping the client app on login.',
  })
  @ApiOkResponse({
    description: 'Authenticated user profile.',
    schema: {
      example: {
        success: true,
        timestamp: '2026-04-08T10:00:00.000Z',
        data: {
          id: 'user-uuid',
          email: 'rahul.sharma@example.com',
          firstName: 'Rahul',
          lastName: 'Sharma',
          phone: '+919876543210',
          avatarUrl: null,
          isActive: true,
          role: { name: 'USER' },
          attendeeProfile: null,
          createdAt: '2026-04-08T10:00:00.000Z',
          updatedAt: '2026-04-08T10:00:00.000Z',
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'No DB record found. User must register first.' })
  getMe(@GetUser('uid') firebaseUid: string) {
    return this.authService.getMe(firebaseUid);
  }

  @Get('check-phone')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check if a phone number is registered',
    description:
      'Public endpoint — no token required. ' +
      'Returns `{ exists: true }` if a user account with the given E.164 phone number exists, ' +
      '`{ exists: false }` otherwise. ' +
      'Intended for the registration screen to warn the user before they attempt to sign up.',
  })
  @ApiQuery({
    name: 'phone',
    description: 'E.164 formatted phone number, e.g. +919876543210',
    example: '+919876543210',
  })
  @ApiOkResponse({
    description: 'Lookup result.',
    schema: { example: { exists: true } },
  })
  checkPhone(@Query('phone') phone: string) {
    return this.authService.checkPhoneExists(phone);
  }
}
