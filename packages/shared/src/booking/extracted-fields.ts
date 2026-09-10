import type { BookingCollected } from './collected';

export type TimePreference = NonNullable<BookingCollected['time_preference']>;

export type ExtractedBookingFields = Partial<
  BookingCollected & {
    confirmation: 'yes' | 'no';
    selected_time: string;
    doctor_name_fragment: string;
  }
>;
