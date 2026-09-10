import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { Resend } from 'resend';

import { type ApiEnv } from '@vaidya/config';
import { AppError } from '@vaidya/shared';

import { API_ENV } from '../../config/api-config.module';

const DEFAULT_EMAIL_FROM = 'Vaidya <noreply@vaidya.local>';

type EmailLayoutInput = {
  title: string;
  greeting: string;
  paragraphs: string[];
  code: string;
  expiryMinutes: number;
};

function buildEmailLayout(input: EmailLayoutInput): string {
  const paragraphsHtml = input.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.65;color:#334155;">${paragraph}</p>`,
    )
    .join('');

  const codeHtml = input.code
    ? `<div style="background:#f0fdfa;border:1px dashed #14b8a6;border-radius:10px;padding:18px;margin:8px 0 18px 0;text-align:center;">
         <span style="font-size:30px;font-weight:800;letter-spacing:8px;color:#0f766e;font-family:monospace;">${input.code}</span>
       </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="background:#0f766e;padding:20px 28px;">
              <p style="margin:0;color:#ffffff;font-size:18px;font-weight:800;font-family:Arial,Helvetica,sans-serif;">Vaidya</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;font-family:Arial,Helvetica,sans-serif;">
              <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:800;color:#0f172a;">${input.title}</h1>
              <p style="margin:0 0 14px 0;font-size:15px;line-height:1.65;color:#334155;">${input.greeting}</p>
              ${paragraphsHtml}
              ${codeHtml}
              <p style="margin:0 0 18px 0;font-size:13px;line-height:1.6;color:#64748b;">
                This code will expire in ${input.expiryMinutes} minutes.
              </p>
              <p style="margin:0 0 18px 0;font-size:13px;line-height:1.6;color:#64748b;">
                If you did not request this, you can safely ignore this email.
              </p>
              <p style="margin:0;font-size:13px;color:#94a3b8;">Thank you,<br/>The Vaidya Team</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

type EmailProvider = 'smtp' | 'resend' | 'dev';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly provider: EmailProvider;
  private smtpTransport: Transporter | null = null;
  private readonly resendClient: Resend | null = null;

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {
    if (this.env.SMTP_HOST && this.env.SMTP_USER && this.env.SMTP_PASS) {
      this.provider = 'smtp';
      this.smtpTransport = createTransport({
        host: this.env.SMTP_HOST,
        port: this.env.SMTP_PORT,
        secure: this.env.SMTP_PORT === 465,
        requireTLS: this.env.SMTP_PORT !== 465,
        auth: { user: this.env.SMTP_USER, pass: this.env.SMTP_PASS },
      });
    } else if (this.env.RESEND_API_KEY) {
      this.provider = 'resend';
      this.resendClient = new Resend(this.env.RESEND_API_KEY);
    } else {
      this.provider = 'dev';
    }
  }

  get providerConfigured(): boolean {
    return this.provider !== 'dev';
  }

  private get from(): string {
    return this.env.EMAIL_FROM?.trim().length ? this.env.EMAIL_FROM : DEFAULT_EMAIL_FROM;
  }

  async sendVerificationCode(to: string, otp: string): Promise<{ messageId: string }> {
    return this.send({
      to,
      subject: 'Verify your email - Vaidya',
      html: buildEmailLayout({
        title: 'Verify Your Email',
        greeting: 'Hello,',
        paragraphs: [
          'Thank you for registering with Vaidya.',
          'Your verification code is:',
        ],
        code: otp,
        expiryMinutes: 10,
      }),
      fallbackOtp: otp,
    });
  }

  async sendPasswordResetCode(to: string, otp: string): Promise<{ messageId: string }> {
    return this.send({
      to,
      subject: 'Reset your password - Vaidya',
      html: buildEmailLayout({
        title: 'Reset Your Password',
        greeting: 'Hello,',
        paragraphs: [
          'We received a request to reset the password for your Vaidya account.',
          'Your password reset code is:',
        ],
        code: otp,
        expiryMinutes: 10,
      }),
      fallbackOtp: otp,
    });
  }

  private async send(input: {
    to: string;
    subject: string;
    html: string;
    fallbackOtp: string;
  }): Promise<{ messageId: string }> {
    if (this.provider === 'dev') {
      if (this.env.NODE_ENV !== 'production') {
        this.logger.warn(
          `No email provider is configured; verification code for ${input.to} is ${input.fallbackOtp}. Set SMTP_HOST/SMTP_USER/SMTP_PASS or RESEND_API_KEY to send real emails.`,
        );
        return { messageId: 'dev-console' };
      }
      this.logger.error('No email provider is configured so the email could not be sent.');
      throw new AppError(
        'PROVIDER_FAILURE',
        'We could not send the email right now. Please try again later.',
      );
    }

    try {
      const { messageId } = await this.sendViaProvider(input);
      return { messageId: messageId || 'unknown' };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error(
        `Email send failed for ${input.to}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      throw new AppError(
        'PROVIDER_FAILURE',
        'We could not send the email right now. Please try again later.',
      );
    }
  }

  private async sendViaProvider(input: {
    to: string;
    subject: string;
    html: string;
  }): Promise<{ messageId?: string }> {
    if (this.provider === 'smtp' && this.smtpTransport) {
      const info = await this.smtpTransport.sendMail({
        from: this.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
      });
      return { messageId: info.messageId };
    }

    if (this.provider === 'resend' && this.resendClient) {
      const { data, error } = await this.resendClient.emails.send({
        from: this.from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
      });

      if (error) {
        this.logger.error(
          `Resend send failed for ${input.to}: ${error.name ?? 'ResendError'} ${error.message ?? ''}`,
        );
        throw new AppError(
          'PROVIDER_FAILURE',
          'We could not send the email right now. Please try again later.',
        );
      }

      return { messageId: data?.id };
    }

    throw new AppError(
      'PROVIDER_FAILURE',
      'We could not send the email right now. Please try again later.',
    );
  }
}
