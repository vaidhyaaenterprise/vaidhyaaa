import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClinicProfileEditModal } from './ClinicProfileEditModal';

const profile = {
  name: 'Care Clinic',
  primary_phone: '9876543210',
  address_line1: '42 Clinic Road',
  address_line2: 'Near the park',
  city: 'Chennai',
  state: 'Tamil Nadu',
  postal_code: '600097',
  country: 'India',
  clinic_unique_number: 1003,
  timezone: 'Asia/Kolkata',
};
afterEach(cleanup);

describe('mandatory clinic profile details', () => {
  it.each([
    'Clinic name',
    'Phone number',
    'Address line 1',
    'Address line 2',
    'City',
    'State',
    'Postal code',
    'Country',
  ])('does not save when %s is blank', (label) => {
    const onSave = vi.fn();
    render(<ClinicProfileEditModal profile={profile} onSave={onSave} onClose={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: label });
    expect(input).toBeRequired();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveFocus();
  });
  it('rejects whitespace-only text and invalid phone/PIN lengths', () => {
    const onSave = vi.fn();
    render(<ClinicProfileEditModal profile={profile} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('City'), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '12345' } });
    fireEvent.change(screen.getByLabelText('Postal code'), { target: { value: '000097' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/10-digit clinic phone number/)).toBeInTheDocument();
    expect(screen.getByText(/PIN code that does not start with 0/)).toBeInTheDocument();
    expect(screen.getByText('City is required.')).toBeInTheDocument();
  });
  it('uses digits-only fields with strict phone and PIN length limits', () => {
    render(<ClinicProfileEditModal profile={profile} onSave={vi.fn()} onClose={vi.fn()} />);
    for (const [label, maxLength, original] of [
      ['Phone number', '10', '9876543210'],
      ['Postal code', '6', '600097'],
    ]) {
      const input = screen.getByLabelText(label!);
      expect(input).toHaveAttribute('inputmode', 'numeric');
      expect(input).toHaveAttribute('maxlength', maxLength!);
      fireEvent.change(input, { target: { value: '123x' } });
      expect(input).toHaveValue(original);
      fireEvent.change(input, { target: { value: '123456789012' } });
      expect(input).toHaveValue(original);
      fireEvent.change(input, { target: { value: '' } });
      expect(input).toHaveValue('');
    }
  });
  it('normalizes legacy +91 display values and saves complete trimmed details', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <ClinicProfileEditModal
        profile={{ ...profile, primary_phone: '+91 98765 43210' }}
        onSave={onSave}
        onClose={onClose}
      />,
    );
    expect(screen.getByLabelText('Phone number')).toHaveValue('9876543210');
    fireEvent.change(screen.getByLabelText('Clinic name'), { target: { value: ' Care Clinic ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const { clinic_unique_number: _number, timezone: _timezone, ...details } = profile;
    expect(onSave).toHaveBeenCalledWith(details);
  });
});
