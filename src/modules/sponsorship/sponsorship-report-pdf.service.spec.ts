import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SponsorshipReportPdfService } from './sponsorship-report-pdf.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';

jest.mock('../orders/pdf-render.util', () => {
  const actual = jest.requireActual('../orders/pdf-render.util');
  return {
    ...actual,
    renderHtmlToPdf: jest.fn().mockResolvedValue(Buffer.from('pdf-content')),
  };
});

describe('SponsorshipReportPdfService', () => {
  let service: SponsorshipReportPdfService;
  let prisma: any;
  let storage: any;

  beforeEach(async () => {
    prisma = {
      sponsorshipInterest: { findUnique: jest.fn() },
      sponsorshipDeal: { findUnique: jest.fn() },
      sponsorshipDealReport: { findUnique: jest.fn() },
    };
    storage = {
      uploadBuffer: jest.fn().mockResolvedValue(undefined),
      getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://storage.example.com/file.pdf'),
    };

    const module = await Test.createTestingModule({
      providers: [
        SponsorshipReportPdfService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('Meetday Global') } },
      ],
    }).compile();

    service = module.get(SponsorshipReportPdfService);
  });

  it('should generate report PDF for proposal-based deal without error', async () => {
    prisma.sponsorshipInterest.findUnique.mockResolvedValue({
      id: 'interest-1',
      sponsorshipProposal: {
        name: 'Proposal Event',
        hostProfile: {
          displayName: 'John Host',
          communityProfile: { name: 'Tech Community' },
        },
      },
      brandProfile: { brandName: 'Acme Corp' },
    });
    prisma.sponsorshipDeal.findUnique.mockResolvedValue({
      id: 'deal-1',
      projectName: 'Test Project',
    });
    prisma.sponsorshipDealReport.findUnique.mockResolvedValue({
      id: 'report-1',
      projectName: 'Report Project',
      summary: JSON.stringify({
        projectName: 'Report Project',
        date: '2026-09-01',
        venue: 'Main Hall',
        deliverables: [{ text: 'Banner', checked: true }],
      }),
      proofKeys: ['proof1.jpg'],
      submittedAt: new Date(),
      status: 'PENDING',
    });

    const buffer = await service.generateForReport('interest-1');
    expect(buffer).toBeDefined();
  });

  it('should generate report PDF for campaign-based deal where sponsorshipProposal is null', async () => {
    prisma.sponsorshipInterest.findUnique.mockResolvedValue({
      id: 'interest-2',
      sponsorshipProposal: null,
      campaign: {
        name: 'Brand Campaign 2026',
        brandProfile: { brandName: 'Brand Co' },
      },
      hostProfile: {
        displayName: 'Host User',
        communityProfile: { name: 'Campaign Community' },
      },
      brandProfile: { brandName: 'Brand Co' },
    });
    prisma.sponsorshipDeal.findUnique.mockResolvedValue({
      id: 'deal-2',
      projectName: 'Campaign Deal',
    });
    prisma.sponsorshipDealReport.findUnique.mockResolvedValue({
      id: 'report-2',
      projectName: 'Campaign Deal Project',
      summary: JSON.stringify({
        projectName: 'Campaign Deal Project',
        date: '2026-09-02',
        venue: 'Open Arena',
      }),
      proofKeys: ['proof2.jpg'],
      submittedAt: new Date(),
      status: 'APPROVED',
    });

    const buffer = await service.generateForReport('interest-2');
    expect(buffer).toBeDefined();
  });
});
