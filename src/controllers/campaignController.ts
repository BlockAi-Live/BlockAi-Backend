import type { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── CONSTANTS ─────────────────────────────────────────
const SECTIONS = ['chat', 'market', 'smart-contracts', 'nft', 'wallet-intel'] as const;
const SECTION_INDEX: Record<string, number> = {
  'chat': 1,
  'market': 2,
  'smart-contracts': 3,
  'nft': 4,
  'wallet-intel': 5,
};

const SOCIAL_TASKS: Record<string, { label: string; points: number }> = {
  'follow_x':         { label: 'Follow Block AI on X (Twitter)', points: 50 },
  'follow_cmc':       { label: 'Follow CoinMarketCap', points: 75 },
  'follow_linkedin':  { label: 'Follow LinkedIn', points: 75 },
  'follow_github':    { label: 'Follow GitHub', points: 75 },
  'join_tg_group':    { label: 'Join Telegram Group', points: 75 },
  'join_tg_channel':  { label: 'Join Telegram Channel', points: 75 },
  'join_discord':     { label: 'Join Discord Server', points: 75 },
};

const ACCESS_CODE_COST = 500;
const FEEDBACK_X_POINTS = 100;
const FEEDBACK_COMMUNITY_POINTS = 10;
const MAX_X_FEEDBACKS = 10;

// ─── HELPERS ───────────────────────────────────────────
async function getOrCreateProgress(userId: string) {
  let progress = await prisma.campaignProgress.findUnique({ where: { userId } });
  if (!progress) {
    progress = await prisma.campaignProgress.create({ data: { userId } });
  }
  return progress;
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// ─── GET CAMPAIGN PROGRESS ─────────────────────────────
export const getCampaignProgress = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const userId = req.user.userId;
    const progress = await getOrCreateProgress(userId);
    const completedTasks = JSON.parse(progress.completedTasks || '[]');
    
    // Calculate total earned from social tasks
    const socialPoints = completedTasks.reduce((sum: number, taskKey: string) => {
      return sum + (SOCIAL_TASKS[taskKey]?.points || 0);
    }, 0);

    // Get user's current points
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { points: true } });

    // Get feedback submissions
    const feedbacks = await prisma.feedbackSubmission.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    // Get user's early access codes
    const codes = await prisma.earlyAccessCode.findMany({
      where: { generatedById: userId },
      select: { code: true, isUsed: true, type: true, createdAt: true },
    });

    return res.json({
      unlockedStage: progress.unlockedStage,
      hasRedeemedCode: progress.hasRedeemedCode,
      isInvestor: progress.isInvestor,
      completedTasks,
      socialPoints,
      totalPoints: user?.points || 0,
      totalXFeedbacks: progress.totalXFeedbacks,
      weeklyFeedbackCount: progress.weeklyFeedbackCount,
      twitterHandle: progress.twitterHandle,
      feedbacks,
      codes,
      sections: SECTIONS,
      socialTasks: SOCIAL_TASKS,
      accessCodeCost: ACCESS_CODE_COST,
    });
  } catch (error) {
    console.error('Campaign progress error:', error);
    return res.status(500).json({ error: 'Failed to fetch campaign progress' });
  }
};

// ─── SET TWITTER HANDLE ────────────────────────────────
export const setTwitterHandle = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const userId = req.user.userId;
    const { twitterHandle } = req.body;

    if (!twitterHandle || typeof twitterHandle !== 'string') {
      return res.status(400).json({ error: 'Twitter handle is required' });
    }

    const handle = twitterHandle.replace(/^@/, '').trim();
    if (!handle) {
      return res.status(400).json({ error: 'Invalid Twitter handle' });
    }

    const progress = await getOrCreateProgress(userId);
    await prisma.campaignProgress.update({
      where: { userId },
      data: { twitterHandle: handle },
    });

    return res.json({ success: true, twitterHandle: handle });
  } catch (error) {
    console.error('Set twitter handle error:', error);
    return res.status(500).json({ error: 'Failed to set Twitter handle' });
  }
};

// ─── COMPLETE SOCIAL TASK ──────────────────────────────
export const completeTask = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const userId = req.user.userId;
    const { taskKey } = req.body;

    if (!taskKey || !SOCIAL_TASKS[taskKey]) {
      return res.status(400).json({ error: 'Invalid task key' });
    }

    const progress = await getOrCreateProgress(userId);

    const completedTasks: string[] = JSON.parse(progress.completedTasks || '[]');

    if (completedTasks.includes(taskKey)) {
      return res.status(400).json({ error: 'Task already completed' });
    }

    completedTasks.push(taskKey);
    const pointsToAward = SOCIAL_TASKS[taskKey].points;

    await prisma.$transaction([
      prisma.campaignProgress.update({
        where: { userId },
        data: { completedTasks: JSON.stringify(completedTasks) },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { points: { increment: pointsToAward } },
      }),
    ]);

    return res.json({ 
      success: true, 
      pointsAwarded: pointsToAward, 
      completedTasks,
    });
  } catch (error) {
    console.error('Complete task error:', error);
    return res.status(500).json({ error: 'Failed to complete task' });
  }
};

// ─── GENERATE EARLY ACCESS CODE ────────────────────────
export const generateAccessCode = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const userId = req.user.userId;
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user || user.points < ACCESS_CODE_COST) {
      return res.status(400).json({ error: `You need at least ${ACCESS_CODE_COST} PTS to generate a code` });
    }

    // Check if user already has an unused code
    const existingCode = await prisma.earlyAccessCode.findFirst({
      where: { generatedById: userId, isUsed: false, type: 'EARNED' },
    });
    if (existingCode) {
      return res.json({ code: existingCode.code, existing: true });
    }

    // Generate code and deduct points
    const code = `BLOCKAI-EA-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { points: { decrement: ACCESS_CODE_COST } },
      }),
      prisma.earlyAccessCode.create({
        data: { code, type: 'EARNED', generatedById: userId },
      }),
    ]);

    return res.json({ code, success: true });
  } catch (error) {
    console.error('Generate code error:', error);
    return res.status(500).json({ error: 'Failed to generate access code' });
  }
};

// ─── REDEEM EARLY ACCESS CODE ──────────────────────────
export const redeemAccessCode = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const userId = req.user.userId;
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }

    const accessCode = await prisma.earlyAccessCode.findUnique({ where: { code } });
    if (!accessCode) {
      return res.status(404).json({ error: 'Invalid code' });
    }
    if (accessCode.isUsed) {
      return res.status(400).json({ error: 'Code has already been used' });
    }
    if (!accessCode.isActive) {
      return res.status(400).json({ error: 'Code is no longer active' });
    }

    const isInvestor = accessCode.type === 'INVESTOR';
    const progress = await getOrCreateProgress(userId);

    await prisma.$transaction([
      prisma.earlyAccessCode.update({
        where: { id: accessCode.id },
        data: { isUsed: true, redeemedById: userId, redeemedAt: new Date() },
      }),
      prisma.campaignProgress.update({
        where: { userId },
        data: {
          hasRedeemedCode: true,
          unlockedStage: isInvestor ? 5 : 1, // Investor = full access, earned = stage 1
          isInvestor,
        },
      }),
    ]);

    return res.json({
      success: true,
      unlockedStage: isInvestor ? 5 : 1,
      isInvestor,
      message: isInvestor 
        ? 'Full access granted. All sections unlocked.'
        : 'Early access activated! Section 1 (Chat) is now unlocked.',
    });
  } catch (error) {
    console.error('Redeem code error:', error);
    return res.status(500).json({ error: 'Failed to redeem code' });
  }
};

// ─── SUBMIT FEEDBACK ───────────────────────────────────
export const submitFeedback = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const userId = req.user.userId;
    const { section, tweetUrl, platform = 'twitter' } = req.body;

    if (!section || !tweetUrl) {
      return res.status(400).json({ error: 'Section and tweet URL are required' });
    }

    if (!SECTION_INDEX[section]) {
      return res.status(400).json({ error: 'Invalid section' });
    }

    const progress = await getOrCreateProgress(userId);

    // Check section is unlocked
    const sectionStage = SECTION_INDEX[section];
    if (progress.unlockedStage < sectionStage && !progress.isInvestor) {
      return res.status(403).json({ error: 'This section is not unlocked yet' });
    }

    // X (Twitter) feedback limits
    if (platform === 'twitter') {
      if (progress.totalXFeedbacks >= MAX_X_FEEDBACKS) {
        return res.status(400).json({ error: 'Maximum X feedbacks reached (10)' });
      }

      // Check existing pending/approved feedback for this section on X
      const existingForSection = await prisma.feedbackSubmission.findFirst({
        where: { userId, section, platform: 'twitter', status: { in: ['PENDING', 'APPROVED'] } },
      });
      if (existingForSection) {
        return res.status(400).json({ error: 'You already submitted feedback for this section on X' });
      }
    }

    // Community (Telegram/Discord) — 1 per day per channel
    if (platform === 'telegram' || platform === 'discord') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const existingToday = await prisma.feedbackSubmission.findFirst({
        where: { userId, platform, createdAt: { gte: today } },
      });
      if (existingToday) {
        return res.status(400).json({ error: `You already submitted feedback on ${platform} today` });
      }
    }

    const submission = await prisma.feedbackSubmission.create({
      data: { userId, section, tweetUrl, platform },
    });

    return res.json({ success: true, submission });
  } catch (error) {
    console.error('Submit feedback error:', error);
    return res.status(500).json({ error: 'Failed to submit feedback' });
  }
};

// ─── EDIT PENDING FEEDBACK ─────────────────────────────
export const editFeedback = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const userId = req.user.userId;
    const { submissionId, tweetUrl } = req.body;

    if (!submissionId || !tweetUrl) {
      return res.status(400).json({ error: 'Submission ID and new tweet URL are required' });
    }

    const submission = await prisma.feedbackSubmission.findUnique({ where: { id: submissionId } });
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    if (submission.userId !== userId) {
      return res.status(403).json({ error: 'Not authorized to edit this submission' });
    }
    if (submission.status !== 'PENDING') {
      return res.status(400).json({ error: 'Only pending submissions can be edited' });
    }

    const updated = await prisma.feedbackSubmission.update({
      where: { id: submissionId },
      data: { tweetUrl: tweetUrl.trim() },
    });

    return res.json({ success: true, submission: updated });
  } catch (error) {
    console.error('Edit feedback error:', error);
    return res.status(500).json({ error: 'Failed to edit feedback' });
  }
};

// ─── ADMIN: REVIEW FEEDBACK ────────────────────────────
export const reviewFeedback = async (req: Request, res: Response) => {
  try {
    const { submissionId, action, reviewNote } = req.body; // action: "approve" | "reject"

    if (!submissionId || !action) {
      return res.status(400).json({ error: 'submissionId and action are required' });
    }

    const submission = await prisma.feedbackSubmission.findUnique({ where: { id: submissionId } });
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    if (submission.status !== 'PENDING') {
      return res.status(400).json({ error: 'Submission already reviewed' });
    }

    if (action === 'approve') {
      const progress = await getOrCreateProgress(submission.userId);
      const sectionStage = SECTION_INDEX[submission.section] || 0;
      const nextStage = Math.min(sectionStage + 1, 5);

      const isXFeedback = submission.platform === 'twitter';
      const pointsToAward = isXFeedback ? FEEDBACK_X_POINTS : FEEDBACK_COMMUNITY_POINTS;

      const updates: any[] = [
        prisma.feedbackSubmission.update({
          where: { id: submissionId },
          data: { status: 'APPROVED', reviewedAt: new Date(), reviewNote, pointsAwarded: pointsToAward },
        }),
        prisma.user.update({
          where: { id: submission.userId },
          data: { points: { increment: pointsToAward } },
        }),
      ];

      // Only unlock next section for X feedback (main channel)
      if (isXFeedback && nextStage > progress.unlockedStage) {
        const currentWeek = getISOWeek(new Date());
        updates.push(
          prisma.campaignProgress.update({
            where: { userId: submission.userId },
            data: {
              unlockedStage: nextStage,
              totalXFeedbacks: { increment: 1 },
              weeklyFeedbackCount: progress.lastFeedbackWeek === currentWeek
                ? { increment: 1 }
                : 1,
              lastFeedbackWeek: currentWeek,
            },
          })
        );
      } else if (isXFeedback) {
        // Section already unlocked but still count the X feedback
        const currentWeek = getISOWeek(new Date());
        updates.push(
          prisma.campaignProgress.update({
            where: { userId: submission.userId },
            data: {
              totalXFeedbacks: { increment: 1 },
              weeklyFeedbackCount: progress.lastFeedbackWeek === currentWeek
                ? { increment: 1 }
                : 1,
              lastFeedbackWeek: currentWeek,
            },
          })
        );
      }

      await prisma.$transaction(updates);

      return res.json({
        success: true,
        message: `Feedback approved. +${pointsToAward} PTS awarded.${isXFeedback && nextStage > progress.unlockedStage ? ` Section ${nextStage} unlocked.` : ''}`,
        pointsAwarded: pointsToAward,
        newStage: isXFeedback ? nextStage : progress.unlockedStage,
      });
    } else {
      // Reject
      await prisma.feedbackSubmission.update({
        where: { id: submissionId },
        data: { status: 'REJECTED', reviewedAt: new Date(), reviewNote },
      });
      return res.json({ success: true, message: 'Feedback rejected' });
    }
  } catch (error) {
    console.error('Review feedback error:', error);
    return res.status(500).json({ error: 'Failed to review feedback' });
  }
};

// ─── ADMIN: CREATE INVESTOR CODE ───────────────────────
export const createInvestorCode = async (req: Request, res: Response) => {
  try {
    const { code: customCode, count = 1 } = req.body;

    const codes = [];
    for (let i = 0; i < Math.min(count, 20); i++) {
      const code = customCode && count === 1
        ? customCode
        : `BLOCKAI-INV-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      
      const created = await prisma.earlyAccessCode.create({
        data: { code, type: 'INVESTOR' },
      });
      codes.push(created.code);
    }

    return res.json({ success: true, codes });
  } catch (error) {
    console.error('Create investor code error:', error);
    return res.status(500).json({ error: 'Failed to create investor code' });
  }
};

// ─── ADMIN: GET ALL FEEDBACK SUBMISSIONS ───────────────
export const getAllFeedback = async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const submissions = await prisma.feedbackSubmission.findMany({
      ...(status ? { where: { status } } : {}),
      include: { user: { select: { fullName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(submissions);
  } catch (error) {
    console.error('Get feedback error:', error);
    return res.status(500).json({ error: 'Failed to fetch feedback' });
  }
};
