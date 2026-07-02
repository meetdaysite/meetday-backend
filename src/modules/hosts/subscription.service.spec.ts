import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SubscriptionService } from './subscription.service';
import { BillingCycle, HostPlan } from '@prisma/client';

// Mock Razorpay before import
const mockPlansCreate = jest.fn();
const mockSubscriptionsCreate = jest.fn();
const mockSubscriptionsCancel = jest.fn();

jest.mock('razorpay', () =>
  jest.fn().mockImplementation(() => ({
    plans: { create: mockPlansCreate },
    subscriptions: { create: mockSubscriptionsCreate, cancel: mockSubscriptionsCancel },
  })),
);

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'razorpay.keyId') return 'rzp_key';
    if (key === 'razorpay.keySecret') return 'rzp_secret';
    return undefined;
  }),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SubscriptionService', () => {
  let service: SubscriptionService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(SubscriptionService);
  });

  describe('createPlanAndSubscription', () => {
    const baseParams = {
      plan: 'PRO' as HostPlan,
      billingCycle: BillingCycle.MONTHLY,
      amountInPaise: 99900,
      hostEmail: 'host@test.com',
      hostProfileId: 'host-profile-uuid',
    };

    it('creates a Razorpay plan with monthly period for MONTHLY billing', async () => {
      mockPlansCreate.mockResolvedValue({ id: 'plan_monthly_123' });
      mockSubscriptionsCreate.mockResolvedValue({ id: 'sub_monthly_456', current_end: null });

      await service.createPlanAndSubscription(baseParams);

      expect(mockPlansCreate).toHaveBeenCalledWith(
        expect.objectContaining({ period: 'monthly', interval: 1 }),
      );
      expect(mockSubscriptionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ plan_id: 'plan_monthly_123', total_count: 12 }),
      );
    });

    it('creates a Razorpay plan with yearly period for YEARLY billing', async () => {
      mockPlansCreate.mockResolvedValue({ id: 'plan_yearly_123' });
      mockSubscriptionsCreate.mockResolvedValue({ id: 'sub_yearly_456', current_end: Math.floor(Date.now() / 1000) + 365 * 86400 });

      await service.createPlanAndSubscription({ ...baseParams, billingCycle: BillingCycle.YEARLY });

      expect(mockPlansCreate).toHaveBeenCalledWith(
        expect.objectContaining({ period: 'yearly' }),
      );
      expect(mockSubscriptionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ total_count: 1 }),
      );
    });

    it('returns razorpayPlanId, razorpaySubscriptionId, and period dates', async () => {
      const currentEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
      mockPlansCreate.mockResolvedValue({ id: 'plan_abc' });
      mockSubscriptionsCreate.mockResolvedValue({ id: 'sub_xyz', current_end: currentEnd });

      const result = await service.createPlanAndSubscription(baseParams);

      expect(result.razorpayPlanId).toBe('plan_abc');
      expect(result.razorpaySubscriptionId).toBe('sub_xyz');
      expect(result.currentPeriodStart).toBeInstanceOf(Date);
      expect(result.currentPeriodEnd).toBeInstanceOf(Date);
      expect(result.currentPeriodEnd.getTime()).toBe(currentEnd * 1000);
    });

    it('computes a fallback period end when Razorpay does not return current_end', async () => {
      mockPlansCreate.mockResolvedValue({ id: 'plan_abc' });
      mockSubscriptionsCreate.mockResolvedValue({ id: 'sub_xyz', current_end: null });

      const result = await service.createPlanAndSubscription(baseParams);

      const diffMs = result.currentPeriodEnd.getTime() - result.currentPeriodStart.getTime();
      // Should be approximately 30 days for MONTHLY
      expect(diffMs).toBeGreaterThan(29 * 86400_000);
      expect(diffMs).toBeLessThan(31 * 86400_000);
    });
  });

  describe('cancelSubscription', () => {
    it('calls Razorpay subscriptions.cancel with cancel_at_cycle_end', async () => {
      mockSubscriptionsCancel.mockResolvedValue({});

      await service.cancelSubscription('sub_abc123');

      expect(mockSubscriptionsCancel).toHaveBeenCalledWith('sub_abc123', { cancel_at_cycle_end: 1 });
    });
  });
});
