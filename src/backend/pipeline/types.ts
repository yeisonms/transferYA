import type {
  ParsedPaymentReceipt,
  ParseResult,
} from '../../domain/parser/types.js';
import type {
  IPaymentFingerprintRepository,
  PaymentFingerprintRecord,
} from '../../domain/idempotency/types.js';
import type { MerchantRoutingService } from '../../domain/routing/service.js';
import type { IWhatsAppCloudApiClient } from '../../whatsapp/types.js';
import type { StoredNotificationRecord } from '../webhook/types.js';
import type { BillingReconciliationService } from '../billing/reconciliation.js';

export type PipelineStatus =
  | 'PROCESSED'
  | 'IGNORED_NON_PAYMENT'
  | 'IGNORED_SUSPENDED_ACCOUNT'
  | 'DUPLICATE_PAYMENT'
  | 'ROUTING_FAILED'
  | 'DISPATCH_FAILED';

export interface DispatchSummary {
  recipientId: string;
  phoneNumber: string;
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface PipelineNotificationUpdate {
  status:
    | 'PROCESSING'
    | 'PROCESSED'
    | 'IGNORED_NON_PAYMENT'
    | 'IGNORED_SUSPENDED_ACCOUNT'
    | 'DUPLICATE_PAYMENT'
    | 'ROUTING_FAILED'
    | 'DISPATCH_FAILED'
    | 'FAILED';
  amount?: number | null;
  senderName?: string | null;
  paymentReference?: string | null;
  whatsappMessageIds?: string[];
  failureReason?: string;
  processedAt?: number;
}

export interface IPipelineNotificationRepository {
  getNotificationById(id: string): Promise<StoredNotificationRecord | null>;
  updateNotification(
    id: string,
    update: PipelineNotificationUpdate,
  ): Promise<void>;
}

export type PipelineResult =
  | {
      status: 'PROCESSED';
      notificationId: string;
      fingerprint: string;
      receipt: ParsedPaymentReceipt;
      merchantId: string;
      dispatches: DispatchSummary[];
      isDogfooding?: boolean;
      invoiceId?: string;
      renewedUntilIso?: string;
      daysRemaining?: number;
    }
  | {
      status: 'IGNORED_NON_PAYMENT';
      notificationId: string;
      reason: string;
    }
  | {
      status: 'DUPLICATE_PAYMENT';
      notificationId: string;
      fingerprint: string;
      existingFingerprintRecord: PaymentFingerprintRecord;
    }
  | {
      status: 'IGNORED_SUSPENDED_ACCOUNT';
      notificationId: string;
      receipt: ParsedPaymentReceipt;
      merchantId: string;
      reason: 'SUBSCRIPTION_PAST_DUE' | 'SUBSCRIPTION_SUSPENDED';
      billingNoticeSent: boolean;
    }
  | {
      status: 'ROUTING_FAILED';
      notificationId: string;
      reason: string;
      details?: string;
      isDogfooding?: boolean;
    }
  | {
      status: 'DISPATCH_FAILED';
      notificationId: string;
      receipt: ParsedPaymentReceipt;
      dispatches: DispatchSummary[];
      error: string;
    };

export interface PaymentPipelineDependencies {
  notificationRepository: IPipelineNotificationRepository;
  fingerprintRepository: IPaymentFingerprintRepository;
  routingService: MerchantRoutingService;
  whatsappClient: IWhatsAppCloudApiClient;
  billingReconciliationService?: BillingReconciliationService;
  parser?: (
    rawText: string,
    rawTitle?: string,
    walletPackage?: string,
  ) => ParseResult;
  fingerprintGenerator?: (
    receipt: ParsedPaymentReceipt,
    captureTimestamp: number,
  ) => string;
  nowProvider?: () => number;
  billingNoticeCooldownMs?: number;
  renewalPriceCop?: number;
}

