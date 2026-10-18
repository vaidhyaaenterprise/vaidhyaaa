import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DigitsInput } from './DigitsInput';

afterEach(cleanup);

function Example({ maxLength }: { maxLength?: number }) {
  const [value, setValue] = useState('100');
  return <DigitsInput aria-label="Amount" value={value} onValueChange={setValue} maxLength={maxLength} />;
}

describe('DigitsInput', () => {
  it('enforces a phone-length limit even for programmatic changes or pasted values', () => {
    render(<Example maxLength={10} />);
    const input = screen.getByRole('textbox', {name: 'Amount'});
    fireEvent.change(input, {target: {value: '98765432101'}});
    expect(input).toHaveValue('100');
    fireEvent.change(input, {target: {value: '9876543210'}});
    expect(input).toHaveValue('9876543210');
  });
  it('allows clearing the entire value and entering a fresh number without a leading zero', () => {
    render(<Example />);
    const input = screen.getByRole('textbox', { name: 'Amount' });
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: '250' } });
    expect(input).toHaveValue('250');
  });

  it.each(['e', '-', '+', '.', 'abc', '12x', '1e3', '12.5'])('rejects non-digit input %s including pasted values', (value) => {
    render(<Example />);
    const input = screen.getByRole('textbox', { name: 'Amount' });
    fireEvent.change(input, { target: { value } });
    expect(input).toHaveValue('100');
    if (value.length === 1) expect(fireEvent.keyDown(input, { key: value })).toBe(false);
  });
});
