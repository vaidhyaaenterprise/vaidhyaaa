import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';

describe('shared state views', () => {
  it('renders loading state', () => {
    render(<LoadingState title="Loading data" description="Please wait" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading data');
    expect(screen.getByText('Please wait')).toBeInTheDocument();
  });

  it('renders empty state', () => {
    render(<EmptyState title="Nothing here" description="No records yet" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText('No records yet')).toBeInTheDocument();
  });

  it('renders error state', () => {
    render(<ErrorState title="Failed" description="Try again" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
    expect(screen.getByText('Try again')).toBeInTheDocument();
  });

  it('renders standard API error message', () => {
    render(
      <ErrorMessage
        error={{ code: 'FORBIDDEN', message: 'Access denied.' }}
        title="Request failed"
      />,
    );
    expect(screen.getByText('Request failed')).toBeInTheDocument();
    expect(screen.getByText('Access denied.')).toBeInTheDocument();
    expect(screen.getByText('FORBIDDEN')).toBeInTheDocument();
  });
});
