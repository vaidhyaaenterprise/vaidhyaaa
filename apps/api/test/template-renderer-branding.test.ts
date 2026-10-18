import { describe, expect, it, vi } from 'vitest';
import { TemplateRenderer } from '../src/modules/conversation/template-renderer.service';

describe('Vaidhyaa template branding', () => {
  it('updates the brand in stored legacy templates while preserving clinic variables', async () => {
    const renderer = Object.create(TemplateRenderer.prototype) as TemplateRenderer;
    Reflect.set(renderer, 'repos', { clinical: {
      findMessageTemplate: vi.fn().mockResolvedValue([{
        templateText: 'Hello. This is Vaidya from {clinic_name}.',
      }]),
    } });
    await expect(renderer.render('booking.greeting', 'english', { clinic_name: 'Vaidya Clinic' }))
      .resolves.toMatchObject({ message_text: 'Hello. This is Vaidhyaa from Vaidya Clinic.' });
  });
});
