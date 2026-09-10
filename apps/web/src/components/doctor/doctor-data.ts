export type PatientVisitHistory = {
  date: string;
  reason: string;
  diagnosis: string;
  doctor: string;
};

export type Patient = {
  id: string;
  name: string;
  age: number;
  gender: 'Male' | 'Female';
  phone: string;
  time: string;
  type: 'in-person' | 'video' | 'phone';
  status: 'waiting' | 'in-progress' | 'visited' | 'skipped';
  reason: string;
  roomNumber?: string;
  diagnosis?: string;
  advice?: string;
  visitNote?: string;
  history: PatientVisitHistory[];
};

export const INITIAL_PATIENTS: Patient[] = [
  {
    id: '1',
    name: 'Arun Kumar',
    age: 52,
    gender: 'Male',
    phone: '+91 98400 12345',
    time: '9:00 AM',
    type: 'in-person',
    status: 'visited',
    reason: 'Knee pain follow-up – 3 months post physiotherapy',
    roomNumber: '203',
    diagnosis: 'Osteoarthritis Grade II – Left Knee',
    advice: 'Diclofenac 50mg BD x 5 days. Continue physio. Review in 6 weeks.',
    visitNote: 'ROM improved. Mild crepitus. No effusion.',
    history: [
      { date: 'Mar 10, 2026', reason: 'Initial knee pain consultation', diagnosis: 'Osteoarthritis Grade I', doctor: 'Dr. M. Kumar' },
      { date: 'Jan 5, 2026', reason: 'Knee swelling after fall', diagnosis: 'Mild ligament strain', doctor: 'Dr. M. Kumar' },
    ],
  },
  {
    id: '2',
    name: 'Lakshmi Devi',
    age: 64,
    gender: 'Female',
    phone: '+91 94440 88221',
    time: '9:30 AM',
    type: 'in-person',
    status: 'visited',
    reason: 'Lower back pain – chronic, worsening at night',
    roomNumber: '203',
    diagnosis: 'Lumbar Spondylosis with disc bulge L4–L5',
    advice: 'Etoricoxib 90mg OD x 7 days. Hot fomentation. Posture advice given.',
    visitNote: 'SLR negative. Paraspinal tenderness++.',
    history: [
      { date: 'Feb 20, 2026', reason: 'Back pain, initial visit', diagnosis: 'Muscle spasm', doctor: 'Dr. M. Kumar' },
    ],
  },
  {
    id: '3',
    name: 'Ramesh Babu',
    age: 38,
    gender: 'Male',
    phone: '+91 98760 55810',
    time: '10:00 AM',
    type: 'in-person',
    status: 'in-progress',
    reason: 'Right shoulder pain after gym injury',
    roomNumber: '203',
    history: [
      { date: 'Nov 3, 2025', reason: 'Shoulder dislocation – reduced in ER', diagnosis: 'Shoulder dislocation – reduced', doctor: 'Dr. M. Kumar' },
    ],
  },
  {
    id: '4',
    name: 'Priya Venkatesh',
    age: 29,
    gender: 'Female',
    phone: '+91 77770 33445',
    time: '10:30 AM',
    type: 'video',
    status: 'waiting',
    reason: 'Ankle sprain follow-up – 2 weeks post injury',
    history: [],
  },
  {
    id: '5',
    name: 'Suresh Rajan',
    age: 47,
    gender: 'Male',
    phone: '+91 90001 67890',
    time: '11:00 AM',
    type: 'in-person',
    status: 'waiting',
    reason: 'Hip replacement pre-surgery assessment',
    roomNumber: '204',
    history: [
      { date: 'Apr 14, 2026', reason: 'Hip pain, X-ray review', diagnosis: 'Avascular Necrosis hip – Grade III', doctor: 'Dr. M. Kumar' },
      { date: 'Mar 1, 2026', reason: 'Hip pain onset', diagnosis: 'Hip OA – early', doctor: 'Dr. M. Kumar' },
    ],
  },
  {
    id: '6',
    name: 'Meena Sundarajan',
    age: 55,
    gender: 'Female',
    phone: '+91 86860 11223',
    time: '11:30 AM',
    type: 'in-person',
    status: 'waiting',
    reason: 'Wrist pain and numbness – suspected carpal tunnel',
    roomNumber: '203',
    history: [],
  },
  {
    id: '7',
    name: 'Vijay Anand',
    age: 41,
    gender: 'Male',
    phone: '+91 99990 77654',
    time: '12:00 PM',
    type: 'phone',
    status: 'waiting',
    reason: 'Post-op follow-up – knee arthroscopy 4 weeks ago',
    history: [
      { date: 'May 14, 2026', reason: 'Knee arthroscopy', diagnosis: 'Meniscal tear – repaired', doctor: 'Dr. M. Kumar' },
    ],
  },
  {
    id: '8',
    name: 'Kavitha Raj',
    age: 33,
    gender: 'Female',
    phone: '+91 81810 44332',
    time: '12:30 PM',
    type: 'in-person',
    status: 'waiting',
    reason: 'Neck pain and headache after road accident',
    roomNumber: '204',
    history: [],
  },
];

export type DailyData = { label: string; patients: number; newPatients: number; followUp: number };

export const DAILY_DATA: DailyData[] = [
  { label: 'Mon', patients: 9, newPatients: 3, followUp: 6 },
  { label: 'Tue', patients: 12, newPatients: 5, followUp: 7 },
  { label: 'Wed', patients: 8, newPatients: 2, followUp: 6 },
  { label: 'Thu', patients: 14, newPatients: 6, followUp: 8 },
  { label: 'Fri', patients: 11, newPatients: 4, followUp: 7 },
  { label: 'Sat', patients: 6, newPatients: 3, followUp: 3 },
  { label: 'Sun', patients: 0, newPatients: 0, followUp: 0 },
];

export const WEEKLY_DATA: DailyData[] = [
  { label: 'Week 1 May', patients: 52, newPatients: 18, followUp: 34 },
  { label: 'Week 2 May', patients: 61, newPatients: 22, followUp: 39 },
  { label: 'Week 3 May', patients: 47, newPatients: 14, followUp: 33 },
  { label: 'Week 4 May', patients: 58, newPatients: 20, followUp: 38 },
  { label: 'Week 1 Jun', patients: 63, newPatients: 25, followUp: 38 },
  { label: 'Week 2 Jun', patients: 55, newPatients: 19, followUp: 36 },
];

export const MONTHLY_DATA: DailyData[] = [
  { label: 'Jan', patients: 198, newPatients: 72, followUp: 126 },
  { label: 'Feb', patients: 213, newPatients: 80, followUp: 133 },
  { label: 'Mar', patients: 187, newPatients: 65, followUp: 122 },
  { label: 'Apr', patients: 224, newPatients: 88, followUp: 136 },
  { label: 'May', patients: 241, newPatients: 95, followUp: 146 },
  { label: 'Jun', patients: 118, newPatients: 46, followUp: 72 },
];

export const CONDITIONS: [string, number, string][] = [
  ['Knee Pain', 89, '#0f766e'],
  ['Back Pain', 67, '#2563eb'],
  ['Joint Pain', 54, '#d97706'],
  ['Fracture', 32, '#dc2626'],
  ['Shoulder', 28, '#7c3aed'],
  ['Leg Pain', 22, '#059669'],
  ['Other', 18, '#0891b2'],
];

export const VISIT_TYPES: [string, number, string][] = [
  ['In-Person', 210, '#0f766e'],
  ['Video Call', 65, '#2563eb'],
  ['Phone', 35, '#d97706'],
];

export const AGE_GROUPS: [string, number][] = [
  ['0–18', 12],
  ['19–30', 38],
  ['31–45', 92],
  ['46–60', 118],
  ['61–75', 87],
  ['75+', 43],
];
