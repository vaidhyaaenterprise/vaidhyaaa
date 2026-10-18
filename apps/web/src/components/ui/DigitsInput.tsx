'use client';

import type { InputHTMLAttributes } from 'react';

type DigitsInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'inputMode' | 'pattern' | 'value' | 'onChange'
> & {
  value: string | number;
  onValueChange: (value: string) => void;
};

/** Keep empty input editable; numeric conversion belongs at the save boundary. */
export function DigitsInput({ value, onValueChange, ...props }: DigitsInputProps) {
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={value}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1 && !/[0-9]/.test(event.key)) {
          event.preventDefault();
        }
      }}
      onChange={(event) => {
        const nextValue = event.target.value;
        if (/^[0-9]*$/.test(nextValue) && (props.maxLength === undefined || nextValue.length <= props.maxLength)) {
          onValueChange(nextValue);
        }
      }}
    />
  );
}
