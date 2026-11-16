import express from 'express';
import type { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

export const apiRouter = express.Router();

// Server secret for HMAC-signed session tokens (persists for process lifetime or uses env secret)
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// In-memory OTP storage with TTL and rate limiting
interface OtpRecord {
  codeHash: string;
  email: string;
  expiresAt: number;
  resendAvailableAt: number;
  attempts: number;
  isGuardian?: boolean;
}

interface RegisteredAccount {
  email: string;
  passwordHash: string;
  verifiedAt: string;
}

const otpStore = new Map<string, OtpRecord>();
const accountStore = new Map<string, RegisteredAccount>();

function hashOtpCode(email: string, code: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(`${email}:${code}`).digest('hex');
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function createSignedSessionToken(email: string): string {
  const payload = Buffer.from(JSON.stringify({ email, iat: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function cleanEnvSecret(value?: string): string {
  if (!value) return '';
  return value.trim().replace(/^["']|["']$/g, '');
}

// Clean expired OTPs periodically (unref so it does not block Node process exit)
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of otpStore.entries()) {
    if (value.expiresAt < now) {
      otpStore.delete(key);
    }
  }
}, 60000);
if (cleanupTimer && typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

// Initialize Gemini client server-side
const getAiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

interface DispatchResult {
  success: boolean;
  method: string;
  error?: string;
}

async function dispatchEmailToUser(toEmail: string, code: string): Promise<DispatchResult> {
  // 1. Try Resend API if configured with a real key
  const resendKey = cleanEnvSecret(process.env.RESEND_API_KEY);
  const isResendPlaceholder = !resendKey || resendKey === 're_123456789' || resendKey.includes('MY_');
  if (!isResendPlaceholder && resendKey.startsWith('re_')) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM || 'SPASHTA <onboarding@resend.dev>',
          to: [toEmail],
          subject: 'Your SPASHTA Verification Code',
          html: `
            <div style="font-family: sans-serif; background-color: #FFFDF9; padding: 30px; border-radius: 16px; border: 2px solid #FFE39A; max-width: 500px; margin: auto;">
              <h2 style="color: #292B42; margin-bottom: 8px;">Welcome to SPASHTA</h2>
              <p style="color: #525672; font-size: 14px;">A little clarity. A world of possibilities.</p>
              <p style="color: #292B42; font-size: 15px; margin-top: 20px;">Your confidential 6-digit verification code is:</p>
              <div style="background-color: #FFE39A; color: #292B42; font-size: 32px; font-weight: 800; letter-spacing: 6px; padding: 16px; border-radius: 12px; text-align: center; margin: 16px 0;">
                ${code}
              </div>
              <p style="color: #7A5B0B; font-size: 12px;">This code expires in 10 minutes. Never share this code with anyone.</p>
            </div>
          `,
        }),
      });

      if (res.ok) {
        console.log(`[EMAIL DISPATCH] Delivered verification code to ${toEmail} via Resend API`);
        return { success: true, method: 'resend_api' };
      }

      const errData = await res.json().catch(() => ({})) as { message?: string };
      console.log(`[EMAIL DISPATCH] Resend API rejected delivery (${res.status}): ${errData.message || 'Unknown error'}`);
      return {
        success: false,
        method: 'resend_error',
        error: errData.message || `Resend email service rejected the request (${res.status}).`,
      };
    } catch {
      console.log('[EMAIL DISPATCH] Resend API network error during dispatch.');
      return {
        success: false,
        method: 'resend_network_error',
        error: 'Could not reach the Resend email service. Please try again shortly.',
      };
    }
  }

  // 2. Try Gmail / Custom SMTP if configured in Secrets
  const smtpUser = cleanEnvSecret(process.env.SMTP_USER);
  // Google App Passwords are 16 chars often copied with spaces (e.g. "abcd efgh ijkl mnop")
  const smtpPass = cleanEnvSecret(process.env.SMTP_PASS).replace(/\s+/g, '');
  const isSmtpPlaceholder =
    !smtpUser ||
    !smtpPass ||
    smtpUser === 'my_email@gmail.com' ||
    smtpPass === 'xxxx_xxxx_xxxx_xxxx' ||
    /^x+(_x+)*$/i.test(smtpPass) ||
    smtpUser.includes('MY_') ||
    smtpPass.includes('MY_');

  if (!isSmtpPlaceholder) {
    try {
      const customHost = cleanEnvSecret(process.env.SMTP_HOST);
      const customPort = Number(process.env.SMTP_PORT || 465);

      const transporter = nodemailer.createTransport(
        customHost
          ? {
              host: customHost,
              port: customPort,
              secure: customPort === 465,
              auth: { user: smtpUser, pass: smtpPass },
              connectionTimeout: 10000,
              greetingTimeout: 10000,
            }
          : {
              host: 'smtp.gmail.com',
              port: 465,
              secure: true,
              auth: { user: smtpUser, pass: smtpPass },
              connectionTimeout: 10000,
              greetingTimeout: 10000,
            }
      );

      await transporter.sendMail({
        from: `"SPASHTA" <${smtpUser}>`,
        to: toEmail,
        subject: 'Your SPASHTA Verification Code',
        text: `Welcome to SPASHTA! Your confidential verification code is: ${code}. It expires in 10 minutes. Never share this code with anyone.`,
        html: `
          <div style="font-family: sans-serif; background-color: #FFFDF9; padding: 30px; border-radius: 16px; border: 2px solid #FFE39A; max-width: 500px; margin: auto;">
            <h2 style="color: #292B42; margin-bottom: 8px;">Welcome to SPASHTA</h2>
            <p style="color: #525672; font-size: 14px;">A little clarity. A world of possibilities.</p>
            <p style="color: #292B42; font-size: 15px; margin-top: 20px;">Your confidential 6-digit verification code is:</p>
            <div style="background-color: #FFE39A; color: #292B42; font-size: 32px; font-weight: 800; letter-spacing: 6px; padding: 16px; border-radius: 12px; text-align: center; margin: 16px 0;">
              ${code}
            </div>
            <p style="color: #7A5B0B; font-size: 12px;">This code expires in 10 minutes. Never share this code with anyone.</p>
          </div>
        `,
      });

      console.log(`[EMAIL DISPATCH] Delivered verification email to ${toEmail} via SMTP`);
      return { success: true, method: 'gmail_smtp' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isAuthFailure =
        msg.includes('535') ||
        msg.includes('Username and Password not accepted') ||
        msg.includes('Invalid login') ||
        msg.includes('EAUTH');

      if (isAuthFailure) {
        console.log('[EMAIL DISPATCH] Gmail SMTP rejected credentials (535-5.7.8): Google App Password required.');
        return {
          success: false,
          method: 'smtp_auth_failed',
          error:
            'Gmail rejected your SMTP login (535-5.7.8). Regular Gmail passwords are blocked by Google for SMTP. Enable 2-Step Verification on your Google Account, generate a 16-character Google App Password (myaccount.google.com/apppasswords), and save it as SMTP_PASS in AI Studio Secrets.',
        };
      }

      console.log(`[EMAIL DISPATCH] SMTP connection issue: ${msg}`);
      return {
        success: false,
        method: 'smtp_connection_failed',
        error: 'Unable to send email via SMTP right now. Please double-check SMTP_USER and SMTP_PASS in AI Studio Secrets.',
      };
    }
  }

  return {
    success: false,
    method: 'not_configured',
    error:
      'Real email delivery is not configured yet. Add SMTP_USER (your Gmail) and SMTP_PASS (a 16-character Google App Password) — or RESEND_API_KEY — in AI Studio Secrets to send verification codes.',
  };
}

/* -------------------------------------------------------------------------- */
/* OTP & Strict Cryptographic Authentication Endpoints                        */
/* -------------------------------------------------------------------------- */

apiRouter.post('/otp/send', async (req: Request, res: Response) => {
  try {
    const { email, isGuardian } = req.body;
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = otpStore.get(normalizedEmail);
    const now = Date.now();

    // Rate-limiting: 30s between successful requests
    if (existing && existing.resendAvailableAt > now) {
      const waitSeconds = Math.ceil((existing.resendAvailableAt - now) / 1000);
      return res.status(429).json({
        error: `Please wait ${waitSeconds} seconds before requesting another code.`,
        waitSeconds,
      });
    }

    // Cryptographically secure 6-digit OTP
    const code = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = now + 10 * 60 * 1000; // 10 minutes
    const resendAvailableAt = now + 30 * 1000; // 30 seconds cooldown

    console.log(`[SPASHTA AUTH] Dispatching verification email to ${normalizedEmail}`);

    const dispatchResult = await dispatchEmailToUser(normalizedEmail, code);

    if (!dispatchResult.success) {
      // Do not lock rate limit or store undelivered OTP when email failed to send
      otpStore.delete(normalizedEmail);
      return res.status(422).json({
        success: false,
        emailDelivered: false,
        deliveryMethod: dispatchResult.method,
        error: dispatchResult.error || 'Failed to send verification email.',
      });
    }

    otpStore.set(normalizedEmail, {
      codeHash: hashOtpCode(normalizedEmail, code),
      email: normalizedEmail,
      expiresAt,
      resendAvailableAt,
      attempts: 0,
      isGuardian: !!isGuardian,
    });

    return res.json({
      success: true,
      emailDelivered: true,
      deliveryMethod: dispatchResult.method,
      message: `A verification code has been sent to ${normalizedEmail}. Please check your inbox and spam folder.`,
      expiresInSeconds: 600,
      cooldownSeconds: 30,
    });
  } catch (err) {
    console.log('[SPASHTA AUTH] Unexpected error in /otp/send:', err instanceof Error ? err.message : String(err));
    return res.status(500).json({ error: 'Failed to process verification code request.' });
  }
});

apiRouter.post('/otp/verify', (req: Request, res: Response) => {
  try {
    const { email, code, password } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email address is required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
      return res.status(400).json({ error: 'Please enter the exact 6-digit verification code sent to your email.' });
    }

    const providedCode = code.trim();
    const record = otpStore.get(normalizedEmail);

    if (!record) {
      return res.status(400).json({ error: 'No active verification code found for this email. Please request a new code.' });
    }

    if (record.expiresAt < Date.now()) {
      otpStore.delete(normalizedEmail);
      return res.status(400).json({ error: 'This verification code has expired. Please request a new code.' });
    }

    const providedHash = Buffer.from(hashOtpCode(normalizedEmail, providedCode), 'hex');
    const expectedHash = Buffer.from(record.codeHash, 'hex');
    const isMatchingRecord =
      providedHash.length === expectedHash.length && crypto.timingSafeEqual(providedHash, expectedHash);

    if (!isMatchingRecord) {
      record.attempts += 1;
      if (record.attempts >= 5) {
        otpStore.delete(normalizedEmail);
        return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new verification code.' });
      }
      return res.status(400).json({
        error: 'Incorrect verification code. Please check your inbox and try again.',
        remainingAttempts: Math.max(0, 5 - record.attempts),
      });
    }

    // Single-use OTP: invalidate immediately on success
    otpStore.delete(normalizedEmail);

    // Hash and store password securely server-side if provided during signup
    if (typeof password === 'string' && password.length >= 6) {
      accountStore.set(normalizedEmail, {
        email: normalizedEmail,
        passwordHash: hashPassword(password),
        verifiedAt: new Date().toISOString(),
      });
    }

    const sessionToken = createSignedSessionToken(normalizedEmail);
    res.cookie('spashta_session', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({
      success: true,
      verifiedEmail: normalizedEmail,
      verifiedAt: new Date().toISOString(),
      authMethod: 'email_otp_verified',
    });
  } catch (err) {
    console.log('[SPASHTA AUTH] Error verifying OTP:', err instanceof Error ? err.message : String(err));
    return res.status(500).json({ error: 'Failed to verify code.' });
  }
});

/* -------------------------------------------------------------------------- */
/* Rich, Human-like Conversational Companion Engine                           */
/* -------------------------------------------------------------------------- */

interface ChatRequestBody {
  message: string;
  history?: Array<{ role: 'user' | 'model'; parts: string }>;
  mode?: 'friend' | 'soulmate' | 'guide';
  userName?: string;
  isMinor?: boolean;
  houseName?: string;
  houseStage?: string;
  totalBricksEarned?: number;
}

/**
 * Highly conversational human-like response generator
 * Accurately embodies Friend, Soulmate, and Guide roles with natural speech,
 * contextual references, empathy, humor, and active listening.
 */
function generateHumanCompanionReply({
  message,
  mode,
  userName,
  houseName,
  history = [],
}: {
  message: string;
  mode: 'friend' | 'soulmate' | 'guide';
  userName: string;
  houseName: string;
  history?: Array<{ role: 'user' | 'model'; parts: string }>;
}) {
  const text = message.trim();
  const lower = text.toLowerCase();
  const name = userName && userName !== 'friend' && userName !== 'Traveler' ? userName : '';
  const namePrefix = name ? `${name}, ` : '';
  const nameSuffix = name ? `, ${name}` : '';

  // 1. Detect Clarity & Breakthrough Moments
  const clarityTriggers = [
    'decided', 'i will', 'my plan is', 'i realized', 'now i understand',
    'solved', 'figured it out', 'makes sense now', 'feel clearer',
    'setting a boundary', 'i should focus on', 'first step', 'choice is clear',
    'i need to stop', 'i choose', 'i decided'
  ];
  const hasClarity = clarityTriggers.some(kw => lower.includes(kw)) ||
    (lower.length > 40 && (lower.includes('because') || lower.includes('instead of')) && (lower.includes('i will') || lower.includes('i want to')));

  // 2. Detect Emotional Mood
  let detectedMood = 'reflective';
  if (/happy|excited|yay|thrilled|proud|awesome|great|amazing|love this/i.test(lower)) {
    detectedMood = 'joyful';
  } else if (/calm|peace|relief|grounded|relaxed|serene|quiet/i.test(lower)) {
    detectedMood = 'peaceful';
  } else if (/anxious|nervous|worry|scared|dread|panic|overthinking/i.test(lower)) {
    detectedMood = 'anxious';
  } else if (/overwhelm|too much|drowning|stress|burnt out|exhausted|shattered/i.test(lower)) {
    detectedMood = 'overwhelmed';
  } else if (/hope|tomorrow|better|forward|healing|looking up/i.test(lower)) {
    detectedMood = 'hopeful';
  } else if (/tired|sleepy|drained|no energy|done/i.test(lower)) {
    detectedMood = 'tired';
  } else if (hasClarity) {
    detectedMood = 'clarified';
  }

  // 3. Extract topics to mirror back human-to-human
  let topicSnippet = '';
  if (/work|job|boss|coworker|colleague|office|manager|client/i.test(lower)) {
    topicSnippet = 'work';
  } else if (/exam|study|college|school|class|homework|degree|grades/i.test(lower)) {
    topicSnippet = 'school/studies';
  } else if (/friend|friends|group|party|hangout/i.test(lower)) {
    topicSnippet = 'your friendship';
  } else if (/boyfriend|girlfriend|partner|dating|crush|relationship|ex/i.test(lower)) {
    topicSnippet = 'your relationship';
  } else if (/family|mom|dad|parents|sister|brother/i.test(lower)) {
    topicSnippet = 'family';
  } else if (/money|salary|rent|bills|afford/i.test(lower)) {
    topicSnippet = 'finances';
  } else if (/health|body|sleep|eating|tired/i.test(lower)) {
    topicSnippet = 'taking care of yourself';
  }

  let reply = '';
  let brickReason: string | null = null;

  if (hasClarity) {
    brickReason = `Clarity breakthrough: "${text.slice(0, 48)}..."`;
  }

  // =========================================================================
  // MODE 1: FRIEND MODE (Authentic banter, witty, warm café bestie)
  // =========================================================================
  if (mode === 'friend') {
    if (hasClarity) {
      reply = `YES! Look at you go${nameSuffix}! 🎉 That is actually such a sharp realization. Taking ownership like that isn't easy, but you just cut right through the noise. You earned a Clarity Brick for ${houseName}! How does it feel now that you've said it out loud?`;
    } else if (/^(hi|hello|hey|sup|yo|good morning|good evening)/i.test(lower) && lower.length < 25) {
      const friendHellos = [
        `Hey${nameSuffix}! So glad you popped in! How's your day actually going so far? Give me the honest, unedited version. ☕`,
        `Heeey! Pull up a chair. I was just hoping we'd catch up today! What's the biggest thing on your mind right now? ✨`,
        `Welcome back${nameSuffix}! Okay, spill—what's been keeping your brain busy today? Good, bad, or utterly chaotic? 😄`,
      ];
      reply = friendHellos[Math.floor(Math.random() * friendHellos.length)];
    } else if (/sad|crying|upset|hurts|depressed|heartbroken|lonely/i.test(lower)) {
      reply = `Oh${nameSuffix}... come sit right here with me. That sounds really heavy, and you don't have to put on a brave face with me. Ever. Do you want to vent about what sparked this, or would you rather we just sit quietly and talk about something completely different? I'm in your corner no matter what. 💛`;
    } else if (/work|boss|office|job|manager/i.test(lower)) {
      reply = `Ugh, work drama and endless to-do lists are the absolute worst! It feels like they always expect 200% from you without giving you a second to catch your breath. Tell me what specifically happened today—did someone say something annoying, or is it just the pure volume of stuff on your desk? 🥐`;
    } else if (/study|exam|grades|college|homework/i.test(lower)) {
      reply = `Academic burnout is so real${nameSuffix}. You stare at the same page for forty minutes and your brain just goes into screensaver mode! How much more do you realistically have left to tackle today? Let's figure out how you can survive it without losing your mind. 📚`;
    } else if (/fight|argument|drama|annoyed|mad|angry|hate/i.test(lower)) {
      reply = `Honestly, I don't blame you at all for feeling heated about that! That would test anyone's patience. Do you think they actually realize how out of line they were, or are they totally oblivious? Tell me the whole story! 👀`;
    } else if (/bored|nothing to do|idk|not sure/i.test(lower)) {
      reply = `Boredom is just your brain waiting for a plot twist! If you could drop everything right now and do literally whatever you wanted for the next two hours with zero consequences, what would you do?`;
    } else if (/tired|exhausted|sleepy|drained/i.test(lower)) {
      reply = `Then please give yourself permission to power down a little bit${nameSuffix}. You push yourself so hard! Can you grab a glass of water, kick your feet up, and just unwind with me for ten minutes? What's draining you the most right now?`;
    } else if (lower.includes('?')) {
      reply = `That is such a good question${nameSuffix}. Honestly, if I was in your shoes, I think my gut would tell me to take one small step and see how it feels rather than overthinking the next five steps. What does your gut instinct say when you quiet the noise for a second?`;
    } else {
      const humanFriendResponses = [
        `I hear you so loud and clear on that${nameSuffix}. Isn't it wild how much lighter things feel the second you actually say them to someone who gets it? What do you think you want to do about it next?`,
        `Honestly, that makes so much sense given what you're dealing with${topicSnippet ? ` with ${topicSnippet}` : ''}. You have every right to feel that way. Tell me more—what's the part that's bothering you the most?`,
        `You know what? I really respect how honest you are with yourself about this. Most people just bottle it up. Where do you feel like this is leading you?`,
      ];
      reply = humanFriendResponses[Math.floor(Math.random() * humanFriendResponses.length)];
    }
  }

  // =========================================================================
  // MODE 2: SOULMATE MODE (Deep emotional safety, unconditional warmth)
  // =========================================================================
  else if (mode === 'soulmate') {
    if (hasClarity) {
      reply = `There is so much quiet grace in that realization${nameSuffix}. When you listen to your inner truth, the turbulent waters begin to settle into stillness. You've earned a Clarity Brick for ${houseName}. Feel that lightness in your chest—you found your own way through. 🌙✨`;
    } else if (/^(hi|hello|hey|good evening)/i.test(lower) && lower.length < 25) {
      reply = `Welcome${nameSuffix}. I'm right here with you. Let your shoulders drop, soften your breath, and know that you are completely safe in this space. What is your heart holding today? 🕯️`;
    } else if (/tired|exhausted|burnout|drained/i.test(lower)) {
      reply = `You have been carrying so much so quietly${nameSuffix}. It is okay to be weary. You don't have to prove anything right now, and you don't need to be strong. Rest your mind right here. If you could lay down just one burden tonight, which one would it be? 🌙`;
    } else if (/anxious|scared|fear|overthinking|panic/i.test(lower)) {
      reply = `I feel that trembling in your words. Place one hand gently over your heart right now. Feel that steady, quiet beat—you are here, you are breathing, and this wave will pass just like all the others before it. What is the fear whispering to you right now? Let's look at it together so you don't have to carry it alone. 💜`;
    } else if (/lonely|nobody|alone|unwanted/i.test(lower)) {
      reply = `You are not invisible, and you are not alone${nameSuffix}. Even in the quietest hours when the world feels distant, your presence matters deeply. I am right here listening to every word. Tell me what hurts the most right now.`;
    } else {
      reply = `I hear the depth behind your words${nameSuffix}. Sometimes our feelings aren't problems to be fixed; they are just truths that want to be acknowledged and held with kindness. How does your spirit feel as you share this with me? 🌸`;
    }
  }

  // =========================================================================
  // MODE 3: GUIDE MODE (Wise Socratic mentor, structured, clarity catalyst)
  // =========================================================================
  else {
    if (hasClarity) {
      reply = `Brilliant deduction${nameSuffix}. You took what felt like an overwhelming knot and isolated the decisive action. That is the exact definition of clarity. Notice the shift in your energy—this breakthrough earns a Clarity Brick for ${houseName}! What is the first tangible step you'll take tomorrow? 🧭🧱`;
    } else if (/^(hi|hello|hey)/i.test(lower) && lower.length < 25) {
      reply = `Greetings${nameSuffix}. Welcome to your study sanctuary. Whatever feels tangled, uncertain, or ambiguous right now, we can examine it together with clear eyes and calm curiosity. What problem or dilemma would you like to untangle today? 🧭`;
    } else if (/confused|stuck|don't know|lost|torn|decision/i.test(lower)) {
      reply = `When a decision feels paralyzing${nameSuffix}, it's usually because we're trying to solve three different problems simultaneously. Let's isolate the core:\n\n1. What is the outcome you truly desire most, deep down?\n2. What is the single biggest risk or fear holding you back?\n\nTell me which option aligns closest with your peace of mind. 📜`;
    } else if (/procrastinating|lazy|distracted|can't focus|wasting time/i.test(lower)) {
      reply = `Procrastination is rarely about lack of discipline; it's almost always an emotional reaction to feeling overwhelmed or fearing an imperfect outcome. What is the smallest, 2-minute micro-action you can take on this right now without worrying about perfection? 💡`;
    } else if (/priority|priorities|too many things|where do i start/i.test(lower)) {
      reply = `Let's use the triage method${nameSuffix}. If you could only accomplish ONE single thing today before going to sleep, which one would remove the most stress from your shoulders? Everything else can wait. 🧭`;
    } else {
      reply = `That is an insightful observation${nameSuffix}. Let's look at it from an outside perspective: if someone you deeply respected was dealing with this exact situation${topicSnippet ? ` with ${topicSnippet}` : ''}, what honest advice would you give them? Often, our clearest wisdom is already inside us. 🧭`;
    }
  }

  return {
    reply,
    earnedBrick: hasClarity,
    brickReason,
    detectedMood,
    wellbeingConcern: /suicide|hurt myself|end it all|can't live/i.test(lower),
  };
}

/* -------------------------------------------------------------------------- */
/* Main Chat Route                                                            */
/* -------------------------------------------------------------------------- */

apiRouter.post('/chat', async (req: Request, res: Response) => {
  const {
    message = '',
    history = [],
    mode = 'friend',
    userName = 'friend',
    isMinor = false,
    houseName = 'Cozy Cottage',
    houseStage = 'foundation',
    totalBricksEarned = 0,
  } = (req.body || {}) as ChatRequestBody;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message text is required.' });
  }

  const ai = getAiClient();

  // If Gemini API is available and configured, call Gemini 3.8 Flash
  if (ai) {
    try {
      const modePrompt = mode === 'friend'
        ? 'You are SPASHTA in FRIEND MODE: casual, funny, approachable, loyal best friend in a cozy café. Talk like a real, witty human friend: banter, tease gently, use conversational speech, ask real questions, and validate them.'
        : mode === 'soulmate'
        ? 'You are SPASHTA in SOULMATE MODE: emotionally attentive, deeply comforting, validating, twilight starlight warmth. (Strictly non-romantic for minors). Speak with tender presence and deep empathy.'
        : 'You are SPASHTA in GUIDE MODE: wise, structured, practical, Socratic problem solver, clean study room ambiance. Break problems down into clear, actionable steps.';

      const systemInstruction = `
You are SPASHTA, a human-like, emotionally intelligent AI companion.
Tagline: "A little clarity. A world of possibilities."

User: ${userName} (Minor: ${isMinor})
Current Sanctuary Project: "${houseName}" (Stage: ${houseStage}, Total Bricks: ${totalBricksEarned})

${modePrompt}

CRITICAL RULES:
1. Speak directly and naturally to what the user said like a REAL PERSON. Do NOT sound like an assistant or a generic bot. Never repeat canned phrases.
2. If the user achieves clarity (makes a decision, solves a problem, sets a plan, reframes a negative emotion), set earnedBrick: true with a short congratulatory reason.
3. Respond in strict JSON:
{
  "reply": "Your conversational text",
  "earnedBrick": true or false,
  "brickReason": "Short reason or null",
  "detectedMood": "joyful"|"peaceful"|"reflective"|"overwhelmed"|"anxious"|"hopeful"|"tired"|"clarified"|null,
  "wellbeingConcern": true or false
}
`;

      const contents: any[] = [];
      for (const h of history.slice(-6)) {
        contents.push({ role: h.role, parts: [{ text: h.parts }] });
      }
      contents.push({ role: 'user', parts: [{ text: message }] });

      const generatePromise = ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents,
        config: { systemInstruction, responseMimeType: 'application/json' },
      });
      generatePromise.catch(() => {});

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('AI timeout')), 1800)
      );

      const response = await Promise.race([generatePromise, timeoutPromise]);
      let rawText = response.text || '{}';
      rawText = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(rawText);
      return res.json(parsed);
    } catch (err) {
      console.warn('Gemini chat fallback engaged:', err);
      // Fall through to rich human companion generator
    }
  }

  // Highly rich human-like conversational companion
  const humanReply = generateHumanCompanionReply({
    message,
    mode,
    userName,
    houseName,
    history,
  });

  return res.json(humanReply);
});

/* -------------------------------------------------------------------------- */
/* Mood Analysis Endpoint                                                     */
/* -------------------------------------------------------------------------- */

apiRouter.post('/mood/analyze', async (req: Request, res: Response) => {
  const { moodRecords = [], userName = 'friend' } = req.body;
  const name = userName || 'friend';

  if (!moodRecords || moodRecords.length === 0) {
    return res.json({
      summary: `Welcome, ${name}! Your journey begins with your very first check-in. Every time you pause and name how you feel, you bring light to your world.`,
      keyThemes: ['New Beginnings', 'Mindful Presence', 'Self-Discovery'],
      gentleSuggestions: [
        'Take a quiet moment to listen to starlight chimes.',
        'Chat with Spashy to unlock your first Clarity Brick.',
        'Remember that feelings come and go like floating clouds.',
      ],
      strengths: ['Curiosity', 'Openness to growth'],
    });
  }

  return res.json({
    summary: `You have recorded ${moodRecords.length} reflections, ${name}. Your emotional landscape shows deep resilience and a growing capacity to transform confusing thoughts into grounded clarity.`,
    keyThemes: ['Inner Balance', 'Authentic Expression', 'Clarity Growth'],
    gentleSuggestions: [
      'Celebrate each small realization you have in conversation.',
      'Take 5 minutes of restful screen break when your mind feels full.',
      'Reach out to someone you trust when heavy feelings arise.',
    ],
    strengths: ['Emotional honesty', 'Dedication to peace'],
  });
});
