import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

// Configuration
const COST_PER_REQUEST_FREE = 1;
const DAILY_LIMIT_FREE = 10;
const COST_PER_REQUEST_PAID = 0; // Unlimited? Or just high.
// Let's say Paid has 1000 daily limit for demo purposes.
const DAILY_LIMIT_PAID = 1000;

interface AccessResult {
  allowed: boolean;
  reason?: string;
  paymentRequired?: boolean;
  paymentInfo?: any;
}

export class X402Service {
  /**
   * Validate Access based on API Key or Wallet Address
   * Checks daily limits and tiered usage.
   */
  static async accessGuard(apiKeyStr?: string, walletAddress?: string): Promise<AccessResult> {
    let userId: string | null = null;

    // 1. Resolve User from API Key
    if (apiKeyStr) {
      const apiKey = await prisma.aPIKey.findUnique({
        where: { key: apiKeyStr },
        include: { user: true },
      });

      if (!apiKey || !apiKey.isActive) {
        return { allowed: false, reason: "Invalid or Inactive API Key" };
      }
      userId = apiKey.userId;
      
      // Track API Key Usage
      await prisma.aPIKey.update({
        where: { id: apiKey.id },
        data: { usageCount: { increment: 1 }, lastUsedAt: new Date() }
      });
    } 
    // 2. Resolve User from Wallet (if no API Key provided, e.g. direct frontend call)
    else if (walletAddress) {
      const user = await prisma.user.findUnique({ where: { walletAddress } });
      if (user) userId = user.id;
    }

    if (!userId) {
      // Allow anonymous limited access? Or deny?
      // For X402 demo, we enforce payment/auth.
      return { 
          allowed: false, 
          reason: "Authentication Required", 
          paymentRequired: true,
          paymentInfo: await this.generatePaymentRequest()
      };
    }

    // 3. Load Billing State
    return await this.checkAccess(userId);
  }

  /**
   * Guard for authenticating via UserID directly (e.g. from JWT)
   */
  static async guardWithUser(userId: string): Promise<AccessResult> {
      return await this.checkAccess(userId);
  }

  /**
   * Core Access Logic
   */
  private static async checkAccess(userId: string): Promise<AccessResult> {
    // 3. Load Billing State
    let billing = await prisma.billingState.findUnique({ where: { userId } });
    if (!billing) {
      // Auto-create for demo
      billing = await prisma.billingState.create({ data: { userId } });
    }

    // 4. Check Daily Reset
    const now = new Date();
    if (billing.lastResetAt.getDate() !== now.getDate()) {
       billing = await prisma.billingState.update({
         where: { userId },
         data: { dailyUsageCount: 0, lastResetAt: now }
       });
    }

    // 5. Check Limits
    const limit = billing.tier === "PAID" ? DAILY_LIMIT_PAID : DAILY_LIMIT_FREE;
    
    if (billing.dailyUsageCount >= limit) {
      return {
        allowed: false,
        reason: "Daily Limit Exceeded",
        paymentRequired: true,
        paymentInfo: await this.generatePaymentRequest(userId)
      };
    }

    // 6. Deduct Credits (if using credit model)
    if (billing.credits < COST_PER_REQUEST_FREE && billing.tier !== "PAID") {
       return {
        allowed: false,
        reason: "Insufficient Credits",
        paymentRequired: true,
        paymentInfo: await this.generatePaymentRequest(userId)
      };
    }

    // 7. Update Usage & Credits
    await prisma.billingState.update({
      where: { userId },
      data: {
        dailyUsageCount: { increment: 1 },
        credits: { decrement: billing.tier === "PAID" ? 0 : COST_PER_REQUEST_FREE }
      }
    });

    // 8. Log It
    await prisma.usageLog.create({
      data: {
        userId,
        action: "API_RESOURCE",
        cost: billing.tier === "PAID" ? 0 : COST_PER_REQUEST_FREE
      }
    });

    return { allowed: true };
  }


  /**
   * Generate 402 Metadata
   */
  static async generatePaymentRequest(userId?: string) {
    // Determine upgrade cost
    const amount = 10.00; // 10 USDC for pro tier
    
    // Check if there is a pending payment to reuse address?
    // For demo, we stick to a static or generated one.
    const demoWallet = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"; 
    
    return {
      amount,
      currency: "USDC",
      address: demoWallet,
      network: "Base Sepolia",
      referenceId: userId || "anonymous" 
    };
  }

  /**
   * Simulate Processing a Payment to Unlock Tier
   */
  static async mockProcessPayment(txHash: string, walletAddress: string, userId: string) {
    // 1. Record Payment
    await prisma.payment.create({
      data: {
        txHash,
        walletAddress,
        userId,
        amount: 10.0,
        status: "COMPLETED"
      }
    });

    // 2. Upgrade User
    // 2. Upgrade User (Upsert to ensure record exists)
    await prisma.billingState.upsert({
      where: { userId },
      create: {
        userId,
        tier: "PAID",
        credits: 120, // 20 Initial + 100 Bonus
        dailyUsageCount: 0
      },
      update: {
        tier: "PAID",
        credits: { increment: 100 } // Bonus credits
      }
    });

    return { success: true, newTier: "PAID" };
  }

  /**
   * Helper to inspect billing
   */
  static async getBilling(userId: string) {
    return await prisma.billingState.findUnique({ where: { userId } });
  }
}
