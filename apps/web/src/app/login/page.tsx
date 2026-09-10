'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useState, type ReactNode } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { ForgotPasswordFlow } from '@/components/auth/ForgotPasswordFlow';
import { RegisterClinicForm } from '@/components/auth/RegisterClinicForm';
import { LoadingState } from '@/components/ui/StateViews';
import { writeDevAuthProfile } from '@/lib/dev-auth/storage';
import { loginWithUsernamePassword } from '@/lib/api/auth';
import { ApiRequestError } from '@/lib/api/client';

type LoginRole = 'clinic_admin' | 'doctor';

const ROLE_ORDER: LoginRole[] = ['clinic_admin', 'doctor'];

const ROLE_LABELS: Record<LoginRole, string> = {
  clinic_admin: 'Clinic Admin',
  doctor: 'Doctor',
};

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */
const GREEN = '#0B7A2A';
const NAVY = '#0f2440';
const MUTED = '#5b6b8c';

/* ------------------------------------------------------------------ */
/* Icons (outline, 1.8 stroke)                                         */
/* ------------------------------------------------------------------ */
type IconProps = { className?: string };

function Svg({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? ''}
      aria-hidden
    >
      {children}
    </svg>
  );
}

function ClinicIcon({ className = '' }: IconProps) {
  return (
    <Svg className={className}>
      {/* Hospital building */}
      <path d="M4 21V8.5L12 4l8 4.5V21" />
      <path d="M3 21h18" />
      {/* Center cross */}
      <path d="M12 9.5v4M10 11.5h4" />
      {/* Windows */}
      <path d="M6.5 13h2M15.5 13h2M6.5 16.5h2M15.5 16.5h2" />
      {/* Door */}
      <path d="M10.5 21v-2.5h3V21" />
    </Svg>
  );
}

function DoctorIcon({ className = '' }: IconProps) {
  return (
    <Svg className={className}>
      {/* Head */}
      <circle cx="12" cy="6.5" r="3.4" />
      {/* Shoulders / coat */}
      <path d="M5.5 21c0-3.6 2.9-5.5 6.5-5.5s6.5 1.9 6.5 5.5" />
      {/* Stethoscope hanging around the neck */}
      <path d="M9.4 14.6v1.6a2.6 2.6 0 0 0 5.2 0v-1.6" />
      <path d="M14.6 16.2c0 2.2 1.4 3.4 2.8 3.9" />
      <circle cx="18.6" cy="20" r="1.6" />
    </Svg>
  );
}

function MailIcon({ className = '' }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </Svg>
  );
}

function LockIcon({ className = '' }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    </Svg>
  );
}

function EyeIcon({ className = '' }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

function EyeOffIcon({ className = '' }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 2.9" />
      <path d="M6.1 6.1C3.9 7.7 2.5 10 2 12c.6 1.6 2.3 4.3 5.5 5.9A9.9 9.9 0 0 0 12 19c1 0 2-.2 2.9-.5" />
      <path d="M3 3l18 18" />
    </Svg>
  );
}

function ArrowRightIcon({ className = '' }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5 12h14M13 6l6 6-6 6" strokeWidth="2.4" />
    </Svg>
  );
}

function CalendarIcon({ className = '' }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <path d="M8 14.5l2 2 4-4" />
      <path d="M15.6 17.4c.52-.52 1.36-.52 1.88 0l.22.22.22-.22c.52-.52 1.36-.52 1.88 0 .52.52.52 1.36 0 1.88l-2.1 2.12-2.1-2.12c-.52-.52-.52-1.36 0-1.88Z" />
    </Svg>
  );
}

function StethoscopeIcon({ className = '' }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6 3v5a5 5 0 0 0 10 0V3" />
      <path d="M11 13v2.5a5 5 0 0 0 5 5h.5a2.5 2.5 0 0 0 2.5-2.5V17" />
      <circle cx="19" cy="14.5" r="2.5" />
    </Svg>
  );
}

function PeopleIcon({ className = '' }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="10" cy="7.5" r="3.5" />
      <path d="M4 20c0-3.3 2.7-5.5 6-5.5 1.15 0 2.22.24 3.15.7" />
      <path d="M15.4 14.2c.62-.62 1.62-.62 2.24 0l.36.36.36-.36c.62-.62 1.62-.62 2.24 0 .62.62.62 1.62 0 2.24l-2.6 2.6-2.6-2.6c-.62-.62-.62-1.62 0-2.24Z" />
    </Svg>
  );
}

function InvoiceIcon({ className = '' }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
      <path d="M8 13h8M8 17h5" />
    </Svg>
  );
}

function ChartIcon({ className = '' }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 21h18" />
      <path d="M6 17v-4M11 17V9M16 17v-6" />
      <path d="M5 8l5-3.5 4 3 5-4" />
    </Svg>
  );
}

function ShieldLockIcon({ className = '' }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3l7 3v6c0 4.6-3 7.6-7 9-4-1.4-7-4.4-7-9V6z" />
      <rect x="9.5" y="11" width="5" height="4" rx="1" />
      <path d="M10.5 11V9.8a1.5 1.5 0 0 1 3 0V11" />
    </Svg>
  );
}

function LeafIcon({ className = '' }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 21V11" />
      <path d="M12 11C12 7 9 5 5 5c0 4 3 7 7 6Z" />
      <path d="M12 13c0-4 3-6 7-6 0 4-3 7-7 6Z" />
    </Svg>
  );
}

function HeartPulseIcon({ className = '' }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 20.5C7 16.5 4 13.5 4 10a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 3.5-3 6.5-8 10.5Z" />
      <path d="M7 11.5h2.5l1.5-2.5 2 5 1.5-2.5H17" />
    </Svg>
  );
}

function ShieldCheckIcon({ className = '' }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3l7 3v6c0 4.6-3 7.6-7 9-4-1.4-7-4.4-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </Svg>
  );
}

function HeadsetIcon({ className = '' }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 13a8 8 0 0 1 16 0" />
      <rect x="3" y="13" width="4" height="6" rx="1.5" />
      <rect x="17" y="13" width="4" height="6" rx="1.5" />
      <path d="M19 19v1a2 2 0 0 1-2 2h-3" />
    </Svg>
  );
}

function UsersIcon({ className = '' }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="9.5" cy="7.5" r="3.5" />
      <path d="M3 20c0-3.3 2.9-5.5 6.5-5.5S16 16.7 16 20" />
      <path d="M16 4.2a3.5 3.5 0 0 1 0 6.6" />
      <path d="M21 20c0-2.7-1.6-4.6-4-5.3" />
    </Svg>
  );
}

function CloudIcon({ className = '' }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.34 9.3 4.5 4.5 0 0 0 6.5 19z" />
    </Svg>
  );
}

/* ------------------------------------------------------------------ */
/* Brand & decoration                                                  */
/* ------------------------------------------------------------------ */
function VaidhyaaLogo({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 240 240" className={className} aria-hidden>
      <defs>
        <linearGradient id="vh-emblem" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#46b134" />
          <stop offset="45%" stopColor="#1f8129" />
          <stop offset="100%" stopColor="#0d5a17" />
        </linearGradient>
        <linearGradient id="vh-ring" x1="0.15" y1="1" x2="0.85" y2="0">
          <stop offset="0%" stopColor="#0d5a17" />
          <stop offset="55%" stopColor="#2f8f30" />
          <stop offset="100%" stopColor="#4fb437" />
        </linearGradient>
        <linearGradient id="vh-leaf-base" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#0e5f18" />
          <stop offset="60%" stopColor="#2b8f2d" />
          <stop offset="100%" stopColor="#4fb437" />
        </linearGradient>
      </defs>

      {/* Outer ring */}
      <circle cx="120" cy="120" r="94" fill="#ffffff" stroke="url(#vh-ring)" strokeWidth="7" />

      {/* Leafy base — two broad leaves sweeping out to the ring at 8 and 4 o'clock */}
      <path
        d="M 118 148 C 90 140 62 136 42 152 C 38 156 41 163 48 164 C 76 182 102 182 118 168 C 122 162 122 154 118 148 Z"
        fill="url(#vh-leaf-base)"
      />
      <path
        d="M 122 148 C 150 140 178 136 198 152 C 202 156 199 163 192 164 C 164 182 138 182 122 168 C 118 162 118 154 122 148 Z"
        fill="url(#vh-leaf-base)"
      />
      <path d="M 120 154 C 113 165 113 177 120 188 C 127 177 127 165 120 154 Z" fill="url(#vh-leaf-base)" />

      {/* Human figure with raised arms — bold V (chevron) */}
      <path
        d="M 50 36 C 52 58 92 122 114 150 L 120 158 L 126 150 C 148 122 188 58 190 36 C 183 31 171 33 162 46 C 151 70 133 94 120 102 C 107 94 89 70 78 46 C 69 33 57 31 50 36 Z"
        fill="url(#vh-emblem)"
      />

      {/* Head */}
      <circle cx="120" cy="74" r="13" fill="url(#vh-emblem)" />

      {/* Rod of Asclepius — white staff over the green torso */}
      <line x1="120" y1="104" x2="120" y2="152" stroke="#ffffff" strokeWidth="6.5" strokeLinecap="round" />
      <path
        d="M 127 110 C 112 113 110 120 119 124 C 128 128 130 134 121 138 C 112 142 110 149 120 153 C 127 156 129 152 126 149"
        stroke="#ffffff"
        strokeWidth="4.6"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="128" cy="106" r="3.4" fill="#ffffff" />
    </svg>
  );
}

function ECGLine({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 140 24" className={className} aria-hidden>
      <polyline
        points="0,12 34,12 44,12 52,4 62,20 72,7 80,12 140,12"
        stroke={GREEN}
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type LeafSpec = { x: number; y: number; r: number; s: number; c: string };

function LeafBranch() {
  const GREENS = ['#8fd14f', '#69bd40', '#4b9c31', '#2f7d24', '#a5dd75'] as const;
  // Thin cascading stems, like the reference foliage
  const stems = [
    'M 60 -6 C 55 22 44 44 22 64',
    'M 130 -4 C 128 12 120 26 106 40',
    'M 190 -2 C 186 12 180 24 170 36',
    'M 352 6 C 300 22 250 40 205 58 C 150 80 90 110 16 158',
    'M 276 42 C 272 74 266 106 250 140',
    'M 208 58 C 204 96 192 134 170 174',
    'M 146 88 C 138 132 118 178 88 220',
    'M 82 102 C 70 152 52 210 24 272',
  ];
  const L = (x: number, y: number, r: number, s: number, c: string): LeafSpec => ({ x, y, r, s, c });
  const leaves: LeafSpec[] = [
    // Larger leaves hugging the top edge, like the reference cluster
    L(18, 6, 95, 1.6, GREENS[0]), L(44, 2, 68, 1.5, GREENS[1]),
    L(102, -3, 58, 1.5, GREENS[4]), L(12, 36, 110, 1.45, GREENS[2]),
    L(158, -5, 48, 1.4, GREENS[0]), L(212, 10, 40, 1.3, GREENS[1]),
    L(250, 4, 52, 1.25, GREENS[3]),
    // Dense corner cluster
    L(52, 20, 80, 1.15, GREENS[0]), L(78, 10, 55, 1.35, GREENS[1]),
    L(104, 22, 100, 1.1, GREENS[2]), L(66, 44, 120, 1.25, GREENS[3]),
    L(96, 40, 70, 1.2, GREENS[0]), L(126, 6, 30, 1.05, GREENS[4]),
    L(140, 26, 60, 1.2, GREENS[1]), L(118, 48, 95, 1.3, GREENS[2]),
    L(152, 44, 45, 1.0, GREENS[0]), L(40, 60, 115, 1.15, GREENS[3]),
    L(84, 62, 95, 1.05, GREENS[1]), L(170, 18, 35, 1.0, GREENS[4]),
    L(188, 38, 60, 1.15, GREENS[2]), L(22, 92, 125, 1.2, GREENS[0]),
    // Main diagonal bough, alternating leaf pairs
    L(320, 21, 30, 1.0, GREENS[1]), L(330, 30, 115, 0.95, GREENS[3]),
    L(287, 36, 35, 1.05, GREENS[0]), L(297, 44, 112, 1.0, GREENS[2]),
    L(254, 51, 42, 1.1, GREENS[4]), L(263, 60, 118, 1.05, GREENS[1]),
    L(220, 66, 38, 1.0, GREENS[0]), L(230, 75, 110, 1.1, GREENS[3]),
    L(187, 81, 45, 1.05, GREENS[1]), L(196, 90, 122, 0.95, GREENS[2]),
    L(154, 96, 35, 1.0, GREENS[4]), L(163, 105, 116, 1.05, GREENS[0]),
    L(120, 111, 40, 0.95, GREENS[2]), L(130, 120, 112, 1.0, GREENS[1]),
    L(87, 126, 44, 1.0, GREENS[3]), L(96, 135, 120, 0.9, GREENS[0]),
    L(54, 141, 48, 0.95, GREENS[1]), L(63, 150, 124, 0.9, GREENS[4]),
    // Drooping strand 1
    L(272, 48, 75, 1.0, GREENS[0]), L(276, 58, 125, 0.95, GREENS[2]),
    L(268, 72, 78, 1.05, GREENS[3]), L(272, 82, 120, 1.0, GREENS[1]),
    L(262, 96, 82, 0.95, GREENS[4]), L(266, 106, 126, 0.9, GREENS[0]),
    L(256, 120, 86, 0.9, GREENS[1]), L(258, 132, 130, 0.85, GREENS[3]),
    // Drooping strand 2
    L(206, 66, 78, 1.0, GREENS[1]), L(210, 76, 124, 0.95, GREENS[3]),
    L(201, 90, 82, 1.0, GREENS[4]), L(205, 100, 128, 0.95, GREENS[0]),
    L(194, 114, 86, 0.95, GREENS[2]), L(197, 124, 124, 0.9, GREENS[1]),
    L(184, 138, 90, 0.9, GREENS[0]), L(185, 150, 132, 0.85, GREENS[3]),
    L(172, 164, 95, 0.85, GREENS[1]),
    // Drooping strand 3
    L(142, 96, 80, 0.95, GREENS[2]), L(146, 106, 126, 0.9, GREENS[0]),
    L(136, 120, 84, 1.0, GREENS[4]), L(139, 130, 130, 0.95, GREENS[1]),
    L(127, 144, 88, 0.95, GREENS[3]), L(128, 156, 134, 0.9, GREENS[0]),
    L(114, 170, 94, 0.9, GREENS[1]), L(113, 182, 138, 0.85, GREENS[2]),
    L(98, 196, 98, 0.85, GREENS[0]), L(96, 208, 142, 0.8, GREENS[4]),
    // Long leftmost drooping strand
    L(78, 110, 84, 0.95, GREENS[1]), L(80, 120, 130, 0.9, GREENS[3]),
    L(68, 136, 90, 0.95, GREENS[0]), L(68, 148, 136, 0.9, GREENS[2]),
    L(57, 162, 96, 0.9, GREENS[4]), L(55, 174, 140, 0.85, GREENS[1]),
    L(45, 188, 100, 0.85, GREENS[3]), L(42, 200, 144, 0.8, GREENS[0]),
    L(34, 216, 104, 0.8, GREENS[1]), L(30, 230, 148, 0.75, GREENS[2]),
    L(24, 246, 108, 0.75, GREENS[0]), L(20, 260, 152, 0.7, GREENS[4]),
  ];
  return (
    <svg
      viewBox="0 0 370 300"
      className="pointer-events-none absolute -left-4 -top-4 block h-[220px] w-[270px] sm:h-[270px] sm:w-[330px] xl:h-[330px] xl:w-[410px] 2xl:h-[400px] 2xl:w-[490px]"
      aria-hidden
    >
      <defs>
        <path id="vh-corner-leaf" d="M0 0 C5 -5.5 17 -7 25 -1 C18 6 6 6 0 0 Z" />
      </defs>
      <g fill="none" stroke="#7f915a" strokeWidth="1.6" strokeLinecap="round" opacity="0.9">
        {stems.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <g>
        {leaves.map((leaf, index) => (
          <use
            key={index}
            href="#vh-corner-leaf"
            transform={`translate(${leaf.x} ${leaf.y}) rotate(${leaf.r}) scale(${leaf.s})`}
            fill={leaf.c}
          />
        ))}
      </g>
    </svg>
  );
}

function WaveDecor() {
  return (
    <svg
      viewBox="0 0 600 900"
      className="pointer-events-none absolute -right-24 top-0 h-full w-[520px] opacity-[0.16]"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d="M520 0 C420 140 380 260 330 380 S220 620 160 760 C120 850 90 900 60 900" stroke="#2f9e44" strokeWidth="18" fill="none" strokeLinecap="round" />
      <path d="M600 120 C500 260 460 380 410 500 S300 740 240 880" stroke="#5db76d" strokeWidth="12" fill="none" strokeLinecap="round" opacity="0.6" />
      <path d="M600 300 C520 420 480 520 430 640 S330 860 300 900" stroke="#2f9e44" strokeWidth="8" fill="none" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Content data                                                        */
/* ------------------------------------------------------------------ */
const FEATURES: Array<{ icon: (p: IconProps) => ReactNode; title: string }> = [
  { icon: CalendarIcon, title: 'Smart Appointments' },
  { icon: StethoscopeIcon, title: 'Doctor Management' },
  { icon: PeopleIcon, title: 'Patient Care' },
  { icon: InvoiceIcon, title: 'Billing & Invoicing' },
  { icon: ChartIcon, title: 'Insightful Analytics' },
  { icon: ShieldLockIcon, title: 'Secure & Reliable' },
];

const BENEFITS: Array<{ icon: (p: IconProps) => ReactNode; title: string; body: string }> = [
  { icon: ShieldCheckIcon, title: 'Secure & Compliant', body: 'Your data is safe with us.' },
  { icon: HeadsetIcon, title: 'AI Voice Assistant', body: 'Automate calls and manage appointments effortlessly.' },
  { icon: UsersIcon, title: 'Multi-User Access', body: 'Role-based access for staff, doctors and administrators.' },
  { icon: CloudIcon, title: 'Cloud Based', body: 'Access anytime, anywhere from any device.' },
];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function LoginPage() {
  const router = useRouter();
  const { status, refresh } = useAuth();
  const [mode, setMode] = useState<'signin' | 'register' | 'forgot'>('signin');
  const [selectedRole, setSelectedRole] = useState<LoginRole>('clinic_admin');
  const [showPassword, setShowPassword] = useState(false);
  const [roleEmail, setRoleEmail] = useState('');
  const [rolePassword, setRolePassword] = useState('');
  const [pendingLogin, setPendingLogin] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    setRoleEmail('');
    setRolePassword('');
    setLoginError(null);
  }, [selectedRole]);

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/');
    }
  }, [status, router]);

  async function completeLogin(identifier: string, password: string) {
    const result = await loginWithUsernamePassword(identifier, password);
    const membership = result.clinics[0];
    if (!membership) {
      throw new ApiRequestError({
        code: 'FORBIDDEN',
        message: 'This login has no active clinic membership.',
      });
    }
    writeDevAuthProfile({
      userId: result.user.id,
      role: membership.role,
      clinicId: membership.clinic_id,
      ...(membership.doctor_id ? { doctorId: membership.doctor_id } : {}),
    });
    await refresh();
    router.replace('/');
    router.refresh();
  }

  async function handleRoleSignIn() {
    if (!roleEmail.trim() || !rolePassword) {
      setLoginError('Enter your username/email and password.');
      return;
    }
    if (pendingLogin) {
      return;
    }
    setPendingLogin(true);
    setLoginError(null);
    try {
      await completeLogin(roleEmail.trim(), rolePassword);
    } catch (err) {
      setLoginError(
        err instanceof ApiRequestError
          ? err.apiError.message
          : 'Sign in failed. Check your credentials and try again.',
      );
    } finally {
      setPendingLogin(false);
    }
  }

  if (status === 'loading' || status === 'authenticated') {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <LoadingState title="Preparing sign in" description="Checking your dev session." />
      </main>
    );
  }

  const inputClass =
    'h-14 w-full rounded-2xl border border-[#dbe3ec] bg-white pl-14 text-[16px] text-[#0f2440] placeholder:text-[#94a3b8] outline-none transition focus:border-[#0B7A2A] focus:ring-4 focus:ring-[#0B7A2A]/10 xl:h-[58px] xl:text-[17px]';

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[radial-gradient(1200px_700px_at_15%_0%,#eef8ee_0%,#f7fbf6_45%,#ffffff_100%)] text-[#0f2440]">
      <LeafBranch />
      <WaveDecor />
      <div
        className="pointer-events-none absolute -bottom-48 right-[-10%] h-[560px] w-[760px] rounded-full bg-[radial-gradient(closest-side,rgba(11,122,42,0.10),transparent)]"
        aria-hidden
      />

      <div className="relative mx-auto grid min-h-screen w-full max-w-[1920px] grid-cols-1 lg:grid-cols-[55fr_45fr]">
        {/* ---------------------------------------------------------- */}
        {/* LEFT — branding                                             */}
        {/* ---------------------------------------------------------- */}
        <section className="flex flex-col items-center justify-center px-6 pb-6 pt-12 lg:px-10 lg:py-8 xl:px-14 2xl:px-20">
          <div className="flex w-full max-w-[860px] flex-col items-center text-center">
            <VaidhyaaLogo className="h-[110px] w-[110px] lg:h-[128px] lg:w-[128px] xl:h-[150px] xl:w-[150px] 2xl:h-[180px] 2xl:w-[180px]" />

            <h1
              className="mt-4 font-display font-bold leading-none tracking-tight text-[56px] lg:mt-5 lg:text-[64px] xl:text-[76px] 2xl:text-[92px]"
              style={{ color: GREEN }}
            >
              <span className="relative inline-block">
                Vaidhyaa
                <svg
                  viewBox="0 0 24 24"
                  className="absolute -top-[0.22em] left-[27%] h-[0.34em] w-[0.34em] text-[#1E8A32]"
                  fill="currentColor"
                  aria-hidden
                >
                  <path d="M12 20v-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
                  <path d="M12 13c0-4.5-3-6.5-7-6 0 5 2.5 7.5 7 6.5Z" />
                  <path d="M12 13c0-4.5 3-6.5 7-6 0 5-2.5 7.5-7 6.5Z" />
                </svg>
              </span>
            </h1>

            <div className="mt-3 flex items-center gap-3 lg:mt-4">
              <span className="hidden h-px w-10 bg-[#0B7A2A]/60 sm:block" aria-hidden />
              <p
                className="text-[13px] font-semibold uppercase tracking-[0.32em] lg:text-[15px] 2xl:text-[17px]"
                style={{ color: GREEN }}
              >
                SMART-CARE — SIMPLIFIED
              </p>
              <ECGLine className="hidden h-5 w-[110px] sm:block 2xl:w-[140px]" />
            </div>

            <div className="mt-2.5 flex items-center gap-3">
              <span className="h-[2px] w-8 rounded-full bg-[#0B7A2A]/50" aria-hidden />
              <p className="text-[14px] font-semibold text-[#14611F] lg:text-[15px] 2xl:text-[16px]">
                Hospital Management Portal
              </p>
              <span className="h-[2px] w-8 rounded-full bg-[#0B7A2A]/50" aria-hidden />
            </div>

            <p className="mt-6 max-w-[620px] text-[17px] font-semibold leading-relaxed text-[#1c2b45] lg:mt-7 lg:text-[18px] 2xl:mt-9 2xl:max-w-[720px] 2xl:text-[21px]">
              All-in-one solution to simplify hospital operations,
              <br className="hidden sm:block" /> enhance patient care and empower healthcare providers.
            </p>

            {/* Six features */}
            <div className="mt-8 hidden w-full items-start justify-center lg:flex lg:mt-9 2xl:mt-12">
              {FEATURES.map((feature, index) => {
                const Icon = feature.icon;
                return (
                  <Fragment key={feature.title}>
                    {index > 0 ? (
                      <span className="mx-1 mt-3 h-14 w-px shrink-0 bg-[#cfd8e3] xl:mx-2 2xl:h-16" aria-hidden />
                    ) : null}
                    <div className="flex w-[104px] flex-col items-center xl:w-[118px] 2xl:w-[136px]">
                      <Icon className="h-9 w-9 text-[#0B7A2A] xl:h-10 xl:w-10 2xl:h-12 2xl:w-12" />
                      <span className="mt-2.5 text-[12.5px] font-semibold leading-snug text-[#1c2b45] xl:text-[13.5px] 2xl:text-[15px]">
                        {feature.title}
                      </span>
                    </div>
                  </Fragment>
                );
              })}
            </div>

            {/* Message card */}
            <div className="mt-8 hidden w-full max-w-[720px] items-center gap-5 rounded-2xl border border-[#cfe8d3] bg-[#eef8ef] px-7 py-5 shadow-[0_8px_24px_rgba(11,122,42,0.07)] lg:flex lg:mt-9 2xl:mt-12 2xl:max-w-[800px] 2xl:px-9 2xl:py-6">
              <LeafIcon className="h-8 w-8 shrink-0 text-[#0B7A2A] 2xl:h-10 2xl:w-10" />
              <p className="flex-1 text-center text-[14.5px] font-semibold leading-relaxed text-[#1c2b45] xl:text-[15.5px] 2xl:text-[17px]">
                Empowering healthcare providers to deliver better care,
                <br className="hidden xl:block" /> streamline operations and build healthier communities.
              </p>
              <span className="hidden h-10 w-px shrink-0 bg-[#cfe8d3] lg:block" aria-hidden />
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#cfe8d3] bg-white text-[#0B7A2A] 2xl:h-12 2xl:w-12">
                <HeartPulseIcon className="h-6 w-6" />
              </span>
            </div>

            {/* Four benefits */}
            <div className="mt-9 hidden w-full max-w-[860px] grid-cols-4 gap-x-6 lg:grid lg:mt-10 2xl:mt-14 2xl:gap-x-8">
              {BENEFITS.map((benefit) => {
                const Icon = benefit.icon;
                return (
                  <div key={benefit.title} className="flex items-start gap-3 text-left">
                    <Icon className="mt-0.5 h-7 w-7 shrink-0 text-[#0B7A2A] 2xl:h-8 2xl:w-8" />
                    <div>
                      <p className="text-[13.5px] font-bold leading-tight text-[#1c2b45] 2xl:text-[15px]">
                        {benefit.title}
                      </p>
                      <p className="mt-1 text-[12px] leading-snug text-[#5b6b8c] 2xl:text-[13px]">
                        {benefit.body}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* RIGHT — login card                                          */}
        {/* ---------------------------------------------------------- */}
        <section className="flex items-center justify-center px-4 pb-12 pt-4 sm:px-8 lg:px-8 lg:py-8 xl:px-12">
          <div className="w-full max-w-[560px] rounded-[28px] border border-[#e6eef0] bg-white px-7 py-8 shadow-[0_24px_64px_rgba(15,36,64,0.08)] sm:px-10 sm:py-10 xl:max-w-[620px] xl:px-12 xl:py-12 2xl:max-w-[680px] 2xl:px-14">
            {mode !== 'forgot' ? (
              <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-[#eef2f7] p-1.5">
                <button
                  type="button"
                  onClick={() => setMode('signin')}
                  className={`h-12 rounded-xl text-[15px] font-bold transition-colors xl:h-[52px] xl:text-[16px] ${
                    mode === 'signin'
                      ? 'bg-white text-[#0f2440] shadow-[0_2px_10px_rgba(15,36,64,0.10)]'
                      : 'text-[#5b6b8c] hover:text-[#0f2440]'
                  }`}
                  aria-pressed={mode === 'signin'}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => setMode('register')}
                  className={`h-12 rounded-xl text-[15px] font-bold transition-colors xl:h-[52px] xl:text-[16px] ${
                    mode === 'register'
                      ? 'bg-white text-[#0f2440] shadow-[0_2px_10px_rgba(15,36,64,0.10)]'
                      : 'text-[#5b6b8c] hover:text-[#0f2440]'
                  }`}
                  aria-pressed={mode === 'register'}
                >
                  Register clinic
                </button>
              </div>
            ) : null}

            {mode === 'register' ? (
              <div className="mt-8">
                <RegisterClinicForm
                  onRegistered={(email) => {
                    setMode('signin');
                    setSelectedRole('clinic_admin');
                    setRoleEmail(email);
                    setRolePassword('');
                  }}
                />
              </div>
            ) : mode === 'forgot' ? (
              <ForgotPasswordFlow onBack={() => setMode('signin')} onDone={() => setMode('signin')} />
            ) : (
              <>
                <h2
                  className="mt-8 text-[34px] font-extrabold leading-none tracking-tight xl:mt-9 xl:text-[40px] 2xl:text-[44px]"
                  style={{ color: NAVY }}
                >
                  Welcome back
                </h2>
                <p className="mt-2.5 text-[15px] xl:text-[16px]" style={{ color: MUTED }}>
                  Select your role and sign in to continue.
                </p>

                {/* Role cards */}
                <div className="mt-7 grid grid-cols-2 gap-4 xl:mt-8">
                  {ROLE_ORDER.map((role) => {
                    const isActive = role === selectedRole;
                    const Icon = role === 'clinic_admin' ? ClinicIcon : DoctorIcon;
                    return (
                      <button
                        key={role}
                        type="button"
                        onClick={() => setSelectedRole(role)}
                        aria-pressed={isActive}
                        className={`flex h-[118px] flex-col items-center justify-center rounded-2xl border transition-all xl:h-[128px] ${
                          isActive
                            ? 'border-[#9fd3ac] bg-[#eef8ef] shadow-[inset_0_-4px_0_0_#0B7A2A]'
                            : 'border-[#dbe3ec] bg-white hover:border-[#b9c7d6]'
                        }`}
                      >
                        <Icon
                          className={`h-10 w-10 xl:h-11 xl:w-11 ${
                            isActive ? 'text-[#0B7A2A]' : 'text-[#1c2b45]'
                          }`}
                        />
                        <span
                          className={`mt-3 text-[15px] font-bold xl:text-[16px] ${
                            isActive ? 'text-[#0B5F22]' : 'text-[#1c2b45]'
                          }`}
                        >
                          {ROLE_LABELS[role]}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Email */}
                <div className="relative mt-6 xl:mt-7">
                  <MailIcon className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#8b9bb4]" />
                  <input
                    id="role-email"
                    value={roleEmail}
                    onChange={(event) => setRoleEmail(event.target.value)}
                    placeholder="Email Address"
                    autoComplete="username"
                    className={`${inputClass} pr-5`}
                  />
                </div>

                {/* Password */}
                <div className="relative mt-4">
                  <LockIcon className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#8b9bb4]" />
                  <input
                    id="role-password"
                    type={showPassword ? 'text' : 'password'}
                    value={rolePassword}
                    onChange={(event) => setRolePassword(event.target.value)}
                    placeholder="Password"
                    autoComplete="current-password"
                    className={`${inputClass} pr-14`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 rounded-lg p-2 text-[#8b9bb4] transition-colors hover:text-[#0B7A2A]"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                  </button>
                </div>

                <div className="mt-3.5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setMode('forgot')}
                    className="text-[14.5px] font-semibold text-[#0B7A2A] transition-colors hover:text-[#085a1f]"
                  >
                    Forgot Password?
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => void handleRoleSignIn()}
                  disabled={pendingLogin || !roleEmail.trim() || !rolePassword}
                  className="relative mt-6 flex h-14 w-full items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#1e9e3c_0%,#136e22_55%,#0b5717_100%)] text-[17px] font-bold text-white shadow-[0_12px_28px_rgba(11,96,29,0.35)] transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 xl:mt-7 xl:h-[58px] xl:text-[18px]"
                >
                  {pendingLogin ? 'Signing in...' : 'Sign In'}
                  <ArrowRightIcon className="absolute right-6 top-1/2 h-5 w-5 -translate-y-1/2" />
                </button>

                {loginError ? (
                  <p className="mt-3 text-sm font-semibold text-red-600">{loginError}</p>
                ) : null}

                <div className="mt-8 flex items-center gap-4 xl:mt-9" aria-hidden>
                  <span className="h-px flex-1 bg-[#dbe3ec]" />
                  <span className="text-[13.5px] text-[#8b9bb4]">or continue with</span>
                  <span className="h-px flex-1 bg-[#dbe3ec]" />
                </div>

                <div className="mt-6 text-center xl:mt-7">
                  <p className="text-[15px] font-semibold" style={{ color: NAVY }}>
                    For any problem contact
                  </p>
                  <a
                    href="mailto:vaidhyaaenterprises@gmail.com"
                    className="mt-1 inline-block text-[16px] font-bold text-[#0B7A2A] hover:underline xl:text-[17px]"
                  >
                    vaidhyaaenterprises@gmail.com
                  </a>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
