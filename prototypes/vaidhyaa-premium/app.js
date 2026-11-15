(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const iconPaths = {
    home: '<path d="M3 11.5 12 4l9 7.5M5 10v10h14V10M9 20v-6h6v6" />',
    phone: '<path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-4-1-2 2c-4.2-1.8-7.2-4.8-9-9l2-2z" />',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />',
    users: '<circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5a3 3 0 0 1 0 6M21 20c0-3-1.9-5.2-4.5-5.8" />',
    setup: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1v.1H9.5V21a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4h-.1V9.5h.1A1.7 1.7 0 0 0 4 8.4a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.46 3.6l.06.06A1.7 1.7 0 0 0 8.4 4a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1v-.1h4.1v.1A1.7 1.7 0 0 0 15 4a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8.4c.35.6.95 1 1.6 1.1h.1v4.1H21a1.7 1.7 0 0 0-1.6 1.4Z" />',
    settings: '<circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.5 1A7 7 0 0 0 15 6l-.4-2.7h-4L10 6a7 7 0 0 0-1.5 1L6 6 4 9.4 6 11a7 7 0 0 0 0 2l-2 1.6L6 18l2.5-1a7 7 0 0 0 1.5 1l.5 2.7h4L15 18a7 7 0 0 0 1.5-1l2.5 1 2-3.4-2-1.6a7 7 0 0 0 0-1Z" />',
    book: '<path d="M5 4h11l3 3v13H5zM16 4v4h4M8 12h8M8 16h5" />',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20V7M2 20h22" />',
    building: '<path d="M4 21V7l8-4 8 4v14M2 21h20M8 9h2M14 9h2M8 13h2M14 13h2M10 21v-4h4v4" />',
    jobs: '<path d="M5 7h14M7 3v4M17 3v4M5 12h14M5 17h9" /><circle cx="18" cy="17" r="3" />',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7M10 19h4" />',
    plus: '<path d="M12 5v14M5 12h14" />',
    chevron: '<path d="m9 18 6-6-6-6" />',
    arrow: '<path d="M5 12h14M14 7l5 5-5 5" />',
    check: '<path d="m7 12 3 3 7-7" />',
    x: '<path d="m6 6 12 12M18 6 6 18" />',
    edit: '<path d="M12 20h9M16.5 3.5a2 2 0 0 1 3 3L8 18l-4 1 1-4z" />',
    search: '<circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />',
    filter: '<path d="M4 6h16M7 12h10M10 18h4" />',
    clock: '<circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />',
    alert: '<path d="M12 3 2.5 20h19zM12 9v4M12 17h.01" />',
    info: '<circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" />',
    shield: '<path d="M12 3 5 6v6c0 4.3 2.8 7 7 9 4.2-2 7-4.7 7-9V6z" />',
    doctor: '<circle cx="12" cy="7" r="4" /><path d="M5 21c0-4 3-7 7-7s7 3 7 7M9 15v2a3 3 0 0 0 6 0v-2" />',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14" />',
    globe: '<circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />',
    card: '<rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" />',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" />',
    clipboard: '<path d="M9 5h6M9 3h6v4H9zM7 5H5v16h14V5h-2M8 11h8M8 15h8" />',
    more: '<circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" />',
    user: '<circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />',
    spark: '<path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />',
    logout: '<path d="M10 17l5-5-5-5M15 12H3M14 4h6v16h-6" />',
    menu: '<path d="M4 7h16M4 12h16M4 17h16" />',
    eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" />',
    'eye-off': '<path d="m3 3 18 18M10.6 6.2A9.5 9.5 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-2.1 2.8M6.1 7.1C3.8 8.8 2.5 12 2.5 12s3.5 6 9.5 6a9.7 9.7 0 0 0 3.2-.5M9.9 9.9a3 3 0 0 0 4.2 4.2" />',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" />',
    key: '<circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M16 7l2 2M14 9l2 2" />',
  };

  function icon(name, className = '') {
    return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.info}</svg>`;
  }

  const navSets = {
    admin: [
      { id: 'home', label: 'Home', icon: 'home' },
      { id: 'call-inbox', label: 'Call inbox', icon: 'phone', badge: '3' },
      { id: 'appointments', label: 'Appointments', icon: 'calendar', badge: '8' },
      { id: 'patient-history', label: 'Patient history', icon: 'users' },
      { id: 'clinic-setup', label: 'Clinic setup', icon: 'setup' },
      { id: 'settings', label: 'Settings', icon: 'settings' },
      { id: 'knowledge-base', label: 'Knowledge base', icon: 'book', badge: '4' },
    ],
    doctor: [
      { id: 'today', label: 'Today', icon: 'home', badge: '6' },
      { id: 'analytics', label: 'Analytics', icon: 'chart', badge: 'Demo' },
      { id: 'patient-history', label: 'Patient history', icon: 'users' },
      { id: 'clinic-setup', label: 'My schedule', icon: 'calendar' },
      { id: 'settings', label: 'Preferences', icon: 'settings' },
    ],
    platform: [
      { id: 'platform-clinics', label: 'Clinic operations', icon: 'building', badge: '12' },
      { id: 'platform-jobs', label: 'Job health', icon: 'jobs', badge: '2' },
      { id: 'platform-notifications', label: 'Notifications', icon: 'bell', badge: '7' },
    ],
  };

  const routeTitles = {
    home: 'Home',
    'call-inbox': 'Call inbox',
    appointments: 'Appointments',
    'patient-history': 'Patient history',
    'clinic-setup': 'Clinic setup',
    settings: 'Settings',
    'knowledge-base': 'Knowledge base',
    today: 'Today',
    analytics: 'Analytics',
    'platform-clinics': 'Clinic operations',
    'platform-jobs': 'Job health',
    'platform-notifications': 'Notification operations',
  };

  const state = {
    persona: 'admin',
    route: 'home',
    selectedCall: 'call-01',
    selectedQueue: 'queue-01',
    setupSection: 'doctors',
    settingsSection: 'agent',
    knowledgeSection: 'overview',
    appointmentSection: 'pending',
    modalStep: 1,
    modalTrigger: null,
    modalType: null,
    userFilter: 'all',
    userSearch: '',
    userModal: null,
  };

  const clinicIdentity = {
    id: 'VAI-CL-2048',
    name: 'Sundaram Family Clinic',
  };

  const clinicDoctors = [
    { id: 'doctor-murugan', name: 'Dr. Murugan', specialty: 'General medicine', initials: 'DM', active: true },
    { id: 'doctor-priya', name: 'Dr. Priya Nair', specialty: 'Paediatrics', initials: 'PN', active: true },
    { id: 'doctor-arjun', name: 'Dr. Arjun Menon', specialty: 'Orthopaedics', initials: 'AM', active: true },
    { id: 'doctor-anitha', name: 'Dr. Anitha Rao', specialty: 'Dermatology', initials: 'AR', active: true },
  ];

  const clinicUsers = [
    { id: 'user-admin-kavya', name: 'Kavya Jayaraman', username: 'kavya.admin', role: 'admin', status: 'active', isCurrent: true, updated: '24 Sep 2026' },
    { id: 'user-admin-nisha', name: 'Nisha Raman', username: 'nisha.operations', role: 'admin', status: 'active', isCurrent: false, updated: '18 Sep 2026' },
    { id: 'user-doctor-murugan', name: 'Dr. Murugan', username: 'murugan.VAI-CL-2048', role: 'doctor', doctorId: 'doctor-murugan', status: 'active', updated: '22 Sep 2026' },
    { id: 'user-doctor-arjun', name: 'Dr. Arjun Menon', username: 'arjun_menon.VAI-CL-2048', role: 'doctor', doctorId: 'doctor-arjun', status: 'active', updated: '12 Sep 2026' },
  ];

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    })[character]);
  }

  function usernameStemForDoctor(name = '') {
    return name
      .replace(/^dr\.?\s*/i, '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32);
  }

  function doctorUsername(stem = '') {
    return `${stem}.${clinicIdentity.id}`;
  }

  function clinicDoctor(doctorId) {
    return clinicDoctors.find((doctor) => doctor.id === doctorId);
  }

  function clinicUser(userId) {
    return clinicUsers.find((user) => user.id === userId);
  }

  function eligibleDoctors(excludingUserId = '') {
    return clinicDoctors.filter((doctor) => doctor.active && !clinicUsers.some((user) => user.role === 'doctor' && user.doctorId === doctor.id && user.id !== excludingUserId));
  }

  const calls = [
    {
      id: 'call-01',
      name: 'Ananya Rao',
      phone: '+91 90000 01427',
      time: '9:42 AM',
      duration: '2m 18s',
      outcome: 'Appointment booked',
      tone: 'success',
      summary: 'Requested a paediatric follow-up. An available slot with Dr. Priya was confirmed after the caller repeated all details.',
      action: 'No staff action required',
      source: 'AI voice receptionist',
      relation: 'Confirmed · 25 Sep · 10:30 AM',
    },
    {
      id: 'call-02',
      name: 'Vikram S.',
      phone: '+91 90000 02614',
      time: '9:17 AM',
      duration: '1m 06s',
      outcome: 'Callback requested',
      tone: 'warning',
      summary: 'Asked when a diagnostic report would be ready. The approved knowledge base did not contain an applicable answer.',
      action: 'Clinic staff callback requested before 1:00 PM',
      source: 'Knowledge fallback',
      relation: 'Callback · CB-1048',
    },
    {
      id: 'call-03',
      name: 'Unknown caller',
      phone: '+91 90000 03882',
      time: '8:54 AM',
      duration: '0m 41s',
      outcome: 'Emergency',
      tone: 'danger',
      summary: 'Caller described acute chest discomfort. The receptionist advised immediate emergency services and stopped the booking flow.',
      action: 'Emergency incident flagged for staff acknowledgement',
      source: 'Safety escalation',
      relation: 'Incident · EM-2031',
    },
    {
      id: 'call-04',
      name: 'Meera Krishnan',
      phone: '+91 90000 04715',
      time: 'Yesterday',
      duration: '1m 32s',
      outcome: 'Appointment rescheduled',
      tone: 'violet',
      summary: 'Requested a new date. A staff-reviewed reschedule request was recorded for the existing orthopaedic appointment.',
      action: 'Completed by clinic administrator',
      source: 'Patient request',
      relation: 'Rescheduled · 27 Sep · 5:30 PM',
    },
  ];

  const queue = [
    { id: 'queue-01', name: 'Lakshmi N.', initials: 'LN', time: '10:30', service: 'General consultation', reason: 'Fever and fatigue', visit: 'Follow-up', status: 'Waiting' },
    { id: 'queue-02', name: 'Rohan Iyer', initials: 'RI', time: '11:00', service: 'General consultation', reason: 'Persistent cough', visit: 'New patient', status: 'Waiting' },
    { id: 'queue-03', name: 'Deepa Ravi', initials: 'DR', time: '9:45', service: 'General consultation', reason: 'Review blood pressure', visit: 'Follow-up', status: 'In progress' },
    { id: 'queue-04', name: 'Karthik M.', initials: 'KM', time: '9:15', service: 'General consultation', reason: 'Routine review', visit: 'Follow-up', status: 'Visited' },
  ];

  const authExperience = $('#authExperience');
  const portalExperience = $('#portalExperience');
  const appContent = $('#appContent');
  const navRoot = $('#primaryNavigation');
  const mobileNav = $('#mobileBottomNav');
  const modalRoot = $('#modalRoot');
  const toastRegion = $('#toastRegion');
  const personaSelect = $('#personaSelect');

  function status(label, tone = 'neutral', iconName = '') {
    return `<span class="status status--${tone}">${iconName ? icon(iconName) : ''}${label}</span>`;
  }

  function button(label, options = {}) {
    const {
      variant = 'secondary',
      small = false,
      iconName = '',
      attrs = '',
      disabled = false,
      type = 'button',
    } = options;
    return `<button class="button button--${variant}${small ? ' button--small' : ''}" type="${type}" ${attrs} ${disabled ? 'disabled' : ''}>${iconName ? icon(iconName) : ''}${label}</button>`;
  }

  function miniAction(label, options = {}) {
    const { variant = '', attrs = '', disabled = false } = options;
    return `<button class="mini-action${variant ? ` mini-action--${variant}` : ''}" type="button" ${attrs} ${disabled ? 'disabled' : ''}>${label}</button>`;
  }

  function pageHeader(kicker, title, description, actions = '') {
    return `<header class="page-header">
      <div class="page-header__copy">
        <span class="page-kicker">${kicker}</span>
        <h1>${title}</h1>
        <p>${description}</p>
      </div>
      ${actions ? `<div class="page-actions">${actions}</div>` : ''}
    </header>`;
  }

  function panelHeader(title, description = '', aside = '') {
    return `<div class="panel-header">
      <div class="panel-header__copy"><h2>${title}</h2>${description ? `<p>${description}</p>` : ''}</div>
      ${aside}
    </div>`;
  }

  function metric(label, value, note, iconName, tone = '') {
    return `<article class="metric-card ${tone ? `metric-card--${tone}` : ''}">
      <div class="metric-card__top"><span class="metric-card__label">${label}</span><span class="metric-card__icon">${icon(iconName)}</span></div>
      <div class="metric-card__value"><strong>${value}</strong><small>${note}</small></div>
    </article>`;
  }

  function appointmentItem({ time, period, name, meta, badge, tone, actions = '', readOnly = false }) {
    return `<article class="appointment-item">
      <div class="appointment-item__time"><strong>${time}</strong><small>${period}</small></div>
      <div class="item-copy">
        <div class="item-copy__top"><h3>${name}</h3>${status(badge, tone)}</div>
        <p>${meta}</p>
      </div>
      <div class="item-actions">${actions || (readOnly ? status('Read only', 'neutral', 'lock') : '')}</div>
    </article>`;
  }

  function permissionNote(title, copy, kind = 'permission') {
    const iconName = kind === 'conflict' ? 'alert' : kind === 'prototype' ? 'info' : 'lock';
    return `<div class="${kind}-note"><span class="${kind}-note__icon">${icon(iconName)}</span><div><strong>${title}</strong><p>${copy}</p></div></div>`;
  }

  function renderAdminHome() {
    const actionButtons = `${status('AI receptionist active', 'success', 'check')}${button('Add manual booking', { variant: 'primary', iconName: 'plus', attrs: 'data-open-modal="manual-booking"' })}`;
    return `${pageHeader('Clinic operations', 'Good morning, Kavya', 'Your clinic day is organised around the next safe action.', actionButtons)}
      <section class="context-banner">
        <div class="context-banner__copy"><span>Wednesday · 24 September · Chennai</span><h2>Your clinic is ready for the day.</h2><p>Two appointment decisions need attention. The AI receptionist is active and the current schedule has no unresolved conflicts.</p></div>
        <div class="context-banner__aside"><div class="context-banner__stat"><strong>2</strong><small>decisions due today</small></div>${status('Schedule clear', 'dark', 'check')}</div>
      </section>
      <section class="metric-grid" aria-label="Operational summary">
        ${metric('Pending confirmation', '2', 'today', 'clock')}
        ${metric('Confirmed visits', '8', 'today', 'calendar')}
        ${metric('Missed requests', '1', 'review only', 'alert')}
        ${metric('Staff actions', '4', 'across inbox', 'clipboard')}
      </section>
      <section class="content-grid">
        <article class="panel span-7">
          ${panelHeader('Needs your action', 'Pending confirmations scheduled for today.', '<span class="panel-count">2</span>')}
          <div class="item-list">
            ${appointmentItem({ time: '10:30', period: 'AM', name: 'Ananya Rao', meta: 'Dr. Priya Nair · Paediatric consultation · Fever follow-up', badge: 'Pending', tone: 'warning', actions: `${miniAction('Confirm', { variant: 'primary', attrs: 'data-simulate="confirm"' })}${miniAction('Cancel', { variant: 'danger', attrs: 'data-open-modal="cancel-confirmation"' })}` })}
            ${appointmentItem({ time: '04:45', period: 'PM', name: 'Vijay Kumar', meta: 'Dr. Arjun Menon · Orthopaedic consultation · Knee pain', badge: 'Pending', tone: 'warning', actions: `${miniAction('Confirm', { variant: 'primary', attrs: 'data-simulate="confirm"' })}${miniAction('Cancel', { variant: 'danger', attrs: 'data-open-modal="cancel-confirmation"' })}` })}
          </div>
        </article>
        <article class="panel span-5">
          ${panelHeader('Next appointments', 'Active appointments in chronological order.', '<button class="text-button" type="button" data-route="appointments">View all</button>')}
          <div class="item-list">
            ${appointmentItem({ time: '11:00', period: 'AM', name: 'Rohan Iyer', meta: 'Dr. Murugan · General consultation', badge: 'Confirmed', tone: 'success' })}
            ${appointmentItem({ time: '11:30', period: 'AM', name: 'Meera K.', meta: 'Dr. Priya · Paediatric consultation', badge: 'Confirmed', tone: 'success' })}
            ${appointmentItem({ time: '12:15', period: 'PM', name: 'Tara S.', meta: 'Dr. Arjun · Orthopaedic consultation', badge: 'Pending', tone: 'warning' })}
          </div>
        </article>
        <article class="panel panel--warning span-7">
          ${panelHeader('Missed actions', 'Past pending requests are retained for review only.', status('Read only', 'neutral', 'lock'))}
          <div class="item-list">
            ${appointmentItem({ time: '06:30', period: 'PM', name: 'Suresh Babu', meta: '23 Sep · Dr. Murugan · General consultation · No action taken', badge: 'Missed', tone: 'danger', readOnly: true })}
          </div>
        </article>
        <article class="panel span-5">
          ${panelHeader('Reception overview', 'Only API-supported operational states are shown.')}
          <div class="setting-row"><div class="setting-row__copy"><strong>AI receptionist</strong><p>Active and ready to answer clinic calls.</p></div>${status('Active', 'success', 'check')}</div>
          <div class="setting-row"><div class="setting-row__copy"><strong>Knowledge readiness</strong><p>48 approved entries are available at runtime.</p></div>${status('Ready', 'success')}</div>
          <div class="setting-row"><div class="setting-row__copy"><strong>Schedule conflicts</strong><p>No unresolved availability conflicts.</p></div>${status('Clear', 'info')}</div>
        </article>
      </section>`;
  }

  function renderAppointments() {
    const headerActions = `${button('Today', { variant: 'secondary', iconName: 'calendar', small: true, attrs: 'data-toast="Showing the current clinic day"' })}${button('New appointment', { variant: 'primary', iconName: 'plus', attrs: 'data-open-modal="manual-booking"' })}`;
    return `${pageHeader('Appointment operations', 'Appointments', 'Manage pending, confirmed, missed, visited and patient-requested changes.', headerActions)}
      <div class="toolbar">
        <div class="toolbar__group"><span class="date-control">${icon('calendar')}<input type="date" value="2026-09-24" aria-label="Filter date" /></span>${button('Clear filter', { variant: 'secondary', small: true, attrs: 'data-toast="Returned to current and upcoming appointments"' })}</div>
        <div class="toolbar__group">${status('Synthetic preview data', 'neutral', 'info')}</div>
      </div>
      <div class="section-tabs" role="tablist" aria-label="Appointment groups">
        ${appointmentTab('pending', 'Pending confirmation', '2')}
        ${appointmentTab('confirmed', 'Confirmed & upcoming', '8')}
        ${appointmentTab('requests', 'Change requests', '3')}
        ${appointmentTab('missed', 'Missed actions', '1')}
        ${appointmentTab('visited', 'Visited', '12')}
      </div>
      <div id="appointmentView">${renderAppointmentSection()}</div>`;
  }

  function appointmentTab(id, label, count) {
    return `<button class="section-tab ${state.appointmentSection === id ? 'is-active' : ''}" type="button" role="tab" aria-selected="${state.appointmentSection === id}" data-appointment-section="${id}">${label} · ${count}</button>`;
  }

  function renderAppointmentSection() {
    if (state.appointmentSection === 'confirmed') {
      return `<section class="content-grid">
        <article class="panel span-12">
          ${panelHeader('Confirmed and upcoming', 'Current and future confirmed appointments, grouped by doctor.')}
          ${doctorGroup('Dr. Murugan', '3 appointments', [
            appointmentItem({ time: '11:00', period: 'AM', name: 'Rohan Iyer', meta: 'General consultation · Persistent cough · New patient', badge: 'Confirmed', tone: 'success', actions: `${miniAction('Mark visited', { variant: 'primary', attrs: 'data-open-modal="visit-completion"' })}${miniAction('Edit date & time', { attrs: 'data-open-modal="reschedule"' })}${miniAction('Cancel', { variant: 'danger', attrs: 'data-open-modal="cancel-confirmation"' })}` }),
            appointmentItem({ time: '12:30', period: 'PM', name: 'Nila Joseph', meta: 'General consultation · Follow-up review', badge: 'Confirmed', tone: 'success', actions: `${miniAction('Mark visited', { variant: 'primary', attrs: 'data-open-modal="visit-completion"' })}${miniAction('Edit date & time', { attrs: 'data-open-modal="reschedule"' })}${miniAction('Cancel', { variant: 'danger', attrs: 'data-open-modal="cancel-confirmation"' })}` }),
          ])}
          ${doctorGroup('Dr. Priya Nair', '2 appointments', [
            appointmentItem({ time: '02:00', period: 'PM', name: 'Ishaan R.', meta: 'Paediatric consultation · Fever follow-up', badge: 'Confirmed', tone: 'success', actions: `${miniAction('Mark visited', { variant: 'primary', attrs: 'data-open-modal="visit-completion"' })}${miniAction('Edit date & time', { attrs: 'data-open-modal="reschedule"' })}${miniAction('Cancel', { variant: 'danger', attrs: 'data-open-modal="cancel-confirmation"' })}` }),
          ])}
        </article>
      </section>`;
    }
    if (state.appointmentSection === 'requests') {
      return `<section class="content-grid">
        <article class="panel span-8">
          ${panelHeader('Pending requests', 'Review the original booking and requested change before deciding.', '<span class="panel-count">3</span>')}
          <div class="item-list">
            <article class="record-item"><div class="item-copy"><div class="item-copy__top"><h3>Meera Krishnan</h3>${status('Reschedule request', 'violet')}</div><p>Original: 25 Sep · 4:30 PM → Requested: 27 Sep · 5:30 PM · Dr. Arjun Menon</p></div><div class="item-actions">${miniAction('Review request', { variant: 'primary', attrs: 'data-open-modal="request-review"' })}</div></article>
            <article class="record-item"><div class="item-copy"><div class="item-copy__top"><h3>Ganesh P.</h3>${status('Cancellation request', 'danger')}</div><p>26 Sep · 11:30 AM · Dr. Murugan · General consultation</p></div><div class="item-actions">${miniAction('Review request', { variant: 'primary', attrs: 'data-open-modal="request-review"' })}</div></article>
          </div>
        </article>
        <article class="panel span-4">${panelHeader('Recent activity', 'Completed appointment changes.')}
          <div class="timeline"><div class="timeline-event"><strong>Reschedule approved</strong><span>Today · 9:10 AM</span><p>24 Sep 4:00 PM → 26 Sep 5:00 PM</p></div><div class="timeline-event"><strong>Cancellation rejected</strong><span>Yesterday · 4:42 PM</span><p>Original appointment retained.</p></div></div>
        </article>
      </section>`;
    }
    if (state.appointmentSection === 'missed') {
      return `<section class="panel panel--warning">${panelHeader('Missed actions', 'Past pending requests are read-only and never expose Confirm or Cancel.', status('Read only', 'neutral', 'lock'))}
        ${permissionNote('No mutation is available', 'This request passed its appointment day without a decision. Review the history and follow up outside the expired booking action.', 'permission')}
        <div class="item-list" style="margin-top:14px">${appointmentItem({ time: '06:30', period: 'PM', name: 'Suresh Babu', meta: '23 Sep · Dr. Murugan · General consultation · Back pain · No action taken', badge: 'Missed', tone: 'danger', readOnly: true })}</div>
      </section>`;
    }
    if (state.appointmentSection === 'visited') {
      return `<section class="panel">${panelHeader('Visited patients', 'Completed consultations with permitted clinical context.', status('12 records', 'info'))}
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Patient</th><th>Doctor</th><th>Service</th><th>Visit</th><th>Clinical summary</th><th>Status</th></tr></thead><tbody>
          <tr><td><strong>Karthik M.</strong><small>Follow-up</small></td><td>Dr. Murugan</td><td>General consultation</td><td>9:15 AM</td><td>Review completed · Advice recorded</td><td>${status('Visited', 'info')}</td></tr>
          <tr><td><strong>Divya Raman</strong><small>New patient</small></td><td>Dr. Priya</td><td>Paediatric consultation</td><td>8:45 AM</td><td>Visit record completed</td><td>${status('Visited', 'info')}</td></tr>
        </tbody></table></div>
      </section>`;
    }
    return `<section class="content-grid">
      <article class="panel span-12">
        ${panelHeader('Pending confirmation', 'Today and future requests grouped by doctor.', '<span class="panel-count">2</span>')}
        ${doctorGroup('Dr. Priya Nair', '1 pending', [appointmentItem({ time: '10:30', period: 'AM', name: 'Ananya Rao', meta: 'Paediatric consultation · Fever follow-up · Voice receptionist', badge: 'Pending', tone: 'warning', actions: `${miniAction('Confirm', { variant: 'primary', attrs: 'data-simulate="confirm"' })}${miniAction('Cancel', { variant: 'danger', attrs: 'data-open-modal="cancel-confirmation"' })}` })])}
        ${doctorGroup('Dr. Arjun Menon', '1 pending', [appointmentItem({ time: '04:45', period: 'PM', name: 'Vijay Kumar', meta: 'Orthopaedic consultation · Knee pain · Web admin', badge: 'Pending', tone: 'warning', actions: `${miniAction('Confirm', { variant: 'primary', attrs: 'data-simulate="confirm"' })}${miniAction('Cancel', { variant: 'danger', attrs: 'data-open-modal="cancel-confirmation"' })}` })])}
      </article>
    </section>`;
  }

  function doctorGroup(name, meta, items) {
    return `<div class="doctor-group"><div class="doctor-group__header"><strong>${name}</strong><span>${meta}</span></div><div class="item-list">${items.join('')}</div></div>`;
  }

  function renderCallInbox() {
    const selected = calls.find((call) => call.id === state.selectedCall) || calls[0];
    return `${pageHeader('Voice operations', 'Call inbox', 'Review aggregated call outcomes and required staff actions. This surface is intentionally read-only.', `${status('Read only', 'neutral', 'lock')}${button('Outcome filter', { variant: 'secondary', iconName: 'filter', attrs: 'data-open-modal="outcome-filter"' })}`)}
      ${permissionNote('Operational outcomes only', 'Recordings, transcripts, removed quick-filter rows and mutation controls are intentionally excluded from this view.', 'permission')}
      <div class="call-layout" style="margin-top:18px">
        <section class="call-list">
          <div class="call-list__header"><strong>Recent calls</strong><span class="status status--neutral">4 shown</span></div>
          ${calls.map((call) => `<button class="call-row ${call.id === state.selectedCall ? 'is-selected' : ''}" type="button" data-call-id="${call.id}"><span class="call-row__icon">${icon('phone')}</span><span class="call-row__copy"><strong>${call.name}</strong><span>${call.time} · ${call.duration} · ${call.phone}</span></span>${status(call.outcome, call.tone)}</button>`).join('')}
        </section>
        <section class="call-detail" aria-live="polite">
          <div class="detail-heading"><div><h2>${selected.name}</h2><p>${selected.phone} · ${selected.time} · ${selected.duration}</p></div>${status(selected.outcome, selected.tone)}</div>
          <div class="detail-grid">
            <div class="detail-field"><small>Required action</small><strong>${selected.action}</strong></div>
            <div class="detail-field"><small>Source status</small><strong>${selected.source}</strong></div>
            <div class="detail-field"><small>Related record</small><strong>${selected.relation}</strong></div>
            <div class="detail-field"><small>Data origin</small><strong>Aggregated call inbox API</strong></div>
          </div>
          <div class="detail-section"><h3>Call summary</h3><p>${selected.summary}</p></div>
          <div class="detail-section"><h3>Patient information</h3><p>Name: ${selected.name === 'Unknown caller' ? 'Not provided' : selected.name}<br />Phone: ${selected.phone}<br />Clinical information: Not collected</p></div>
          <div class="detail-section"><h3>Privacy-conscious audit</h3><p>Only operational outcomes are visible here. Sensitive media is not included in the call inbox design.</p></div>
        </section>
      </div>`;
  }

  function renderPatientHistory() {
    return `${pageHeader(state.persona === 'doctor' ? 'Doctor workspace' : 'Patient records', 'Patient history', 'Search combined appointment and visit history with permission-aware clinical details.', status('Clinic scoped', 'neutral', 'lock'))}
      <section class="search-panel">
        <label class="form-field"><span>Patient phone</span><input type="tel" value="+91 90000 05214" /></label>
        <label class="form-field"><span>Patient name</span><input type="text" placeholder="Search by name" /></label>
        <label class="form-field"><span>Patient age</span><input type="number" min="0" max="130" placeholder="Optional" /></label>
        ${button('Search', { variant: 'primary', iconName: 'search', attrs: 'data-toast="One synthetic patient record found"' })}
      </section>
      <div class="prototype-note"><span class="prototype-note__icon">${icon('info')}</span><div><strong>Search requirement</strong><p>Enter at least one of phone, name or integer age. This preview uses synthetic patient details.</p></div></div>
      <section class="patient-result" style="margin-top:16px">
        <span class="avatar">MR</span><div class="patient-result__copy"><strong>Meera Raman</strong><span>+91 90000 05214 · Age 36 · Female</span></div>
        <div class="patient-result__metric"><small>Last visit</small><strong>12 Sep 2026</strong></div>
        <div class="patient-result__metric"><small>Records</small><strong>6 entries</strong></div>
        ${button('View full history', { variant: 'secondary', small: true, attrs: 'data-open-modal="patient-history"' })}
      </section>`;
  }

  const setupSections = [
    { id: 'doctors', label: 'Doctors & services', icon: 'doctor' },
    { id: 'hours', label: 'Working hours', icon: 'clock' },
    { id: 'holidays', label: 'Holidays', icon: 'calendar' },
    { id: 'schedules', label: 'Doctor schedules', icon: 'calendar' },
    { id: 'rules', label: 'Booking rules', icon: 'settings' },
    { id: 'users', label: 'User management', icon: 'users' },
  ];

  function renderClinicSetup() {
    const isDoctor = state.persona === 'doctor';
    if (isDoctor && !['schedules', 'rules'].includes(state.setupSection)) state.setupSection = 'schedules';
    const available = isDoctor ? setupSections.filter((item) => ['schedules', 'rules'].includes(item.id)) : setupSections;
    return `${pageHeader(isDoctor ? 'Doctor configuration' : 'Clinic configuration', isDoctor ? 'My schedule' : 'Clinic setup', isDoctor ? 'Review your permitted schedule and booking rules.' : 'Configure doctors, services, availability, rules and clinic access without changing business constraints.', isDoctor ? status('Permission scoped', 'neutral', 'lock') : button('Save changes', { variant: 'primary', attrs: 'data-toast="Design preview only — no settings were changed"' }))}
      <div class="setup-layout">
        <nav class="setup-nav" aria-label="Clinic setup sections">${available.map((item) => `<button type="button" class="${state.setupSection === item.id ? 'is-active' : ''}" data-setup-section="${item.id}">${icon(item.icon)}<span>${item.label}</span></button>`).join('')}</nav>
        <section id="setupContent">${renderSetupSection()}</section>
      </div>`;
  }

  function renderSetupSection() {
    switch (state.setupSection) {
      case 'hours':
        return `<section class="form-section">${sectionHeading('Clinic working hours', 'Configure zero, one or multiple windows per day. Expansions are safe; contractions may require conflict resolution.', button('Edit hours', { variant: 'secondary', small: true, iconName: 'edit', attrs: 'data-toast="Working-hours editor opened in preview"' }))}
          <div class="schedule-list">${['Monday|9:00 AM – 1:00 PM · 5:00 PM – 9:00 PM', 'Tuesday|9:00 AM – 1:00 PM · 5:00 PM – 9:00 PM', 'Wednesday|9:00 AM – 1:00 PM · 5:00 PM – 9:00 PM', 'Thursday|9:00 AM – 1:00 PM · 5:00 PM – 9:00 PM', 'Friday|9:00 AM – 1:00 PM · 5:00 PM – 9:00 PM', 'Saturday|9:00 AM – 1:00 PM', 'Sunday|Closed'].map((row) => { const [day, hours] = row.split('|'); return `<div class="schedule-row"><span class="schedule-row__day">${day}</span><span class="schedule-row__hours">${hours}</span>${miniAction('Edit', { attrs: 'data-toast="Preview: edit time windows"' })}</div>`; }).join('')}</div>
        </section>
        <section class="form-section">${sectionHeading('Conflict preview', 'Shortening Friday evening hours would affect one future appointment.', status('1 conflict', 'warning', 'alert'))}
          ${permissionNote('Appointment must be resolved first', 'Meera Krishnan · 26 Sep · 7:30 PM · Dr. Arjun Menon · Orthopaedic consultation · Appointment falls outside the proposed hours.', 'conflict')}
          <div class="item-actions" style="margin-top:14px">${button('Resolve appointment', { variant: 'secondary', small: true, attrs: 'data-open-modal="reschedule"' })}${button('Check again', { variant: 'primary', small: true, attrs: 'data-toast="Conflict check refreshed"' })}</div>
        </section>`;
      case 'holidays':
        return `<section class="form-section">${sectionHeading('Holiday setup', 'Block the full clinic or selected doctors while protecting existing appointments.', button('Add holiday', { variant: 'primary', small: true, iconName: 'plus', attrs: 'data-open-modal="holiday"' }))}
          <div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Reason</th><th>Applies to</th><th>Status</th><th>Action</th></tr></thead><tbody><tr><td><strong>2 Oct 2026</strong></td><td>Clinic holiday</td><td>Whole clinic</td><td>${status('Active', 'success')}</td><td>${miniAction('Remove', { variant: 'danger', attrs: 'data-open-modal="delete-confirmation"' })}</td></tr><tr><td><strong>20 Oct 2026</strong></td><td>Conference</td><td>Dr. Priya Nair</td><td>${status('Active', 'success')}</td><td>${miniAction('Remove', { variant: 'danger', attrs: 'data-open-modal="delete-confirmation"' })}</td></tr></tbody></table></div>
        </section>`;
      case 'schedules':
        return `<section class="form-section">${sectionHeading(state.persona === 'doctor' ? 'My schedule' : 'Doctor schedules', 'Doctor hours must remain inside clinic working hours and future slots regenerate after save.', state.persona === 'doctor' ? status('Personal schedule', 'info') : '<select class="filter-select" aria-label="Select doctor"><option>Dr. Murugan</option><option>Dr. Priya Nair</option><option>Dr. Arjun Menon</option></select>')}
          ${state.persona === 'doctor' ? permissionNote('Edits are permission dependent', 'The API decides whether this doctor may change the personal schedule. Booking rules remain read-only unless explicitly granted.', 'permission') : ''}
          <div class="schedule-list" style="margin-top:14px">${['Monday|9:00 AM – 1:00 PM', 'Tuesday|9:00 AM – 1:00 PM', 'Wednesday|5:00 PM – 9:00 PM', 'Thursday|9:00 AM – 1:00 PM', 'Friday|5:00 PM – 9:00 PM', 'Saturday|9:00 AM – 1:00 PM', 'Sunday|Not working'].map((row) => { const [day, hours] = row.split('|'); return `<div class="schedule-row"><span class="schedule-row__day">${day}</span><span class="schedule-row__hours">${hours}</span>${miniAction('Edit', { attrs: 'data-toast="Schedule editor shown in preview"', disabled: state.persona === 'support' })}</div>`; }).join('')}</div>
        </section>`;
      case 'rules':
        return `<section class="form-section">${sectionHeading('Booking rules', 'Changes preview future impact and may apply from the next safe date.', state.persona === 'doctor' ? status('Read only', 'neutral', 'lock') : button('Edit rules', { variant: 'secondary', small: true, iconName: 'edit', attrs: 'data-toast="Booking-rules editor opened in preview"' }))}
          <div class="form-grid form-grid--three"><label class="form-field"><span>Slot duration</span><input type="text" value="30 minutes" ${state.persona === 'doctor' ? 'disabled' : ''} /></label><label class="form-field"><span>Capacity per slot</span><input type="number" value="1" ${state.persona === 'doctor' ? 'disabled' : ''} /></label><label class="form-field"><span>Booking horizon</span><input type="text" value="45 days" ${state.persona === 'doctor' ? 'disabled' : ''} /></label><label class="form-field"><span>Edit cutoff</span><input type="text" value="60 minutes" ${state.persona === 'doctor' ? 'disabled' : ''} /></label><label class="form-field"><span>Maximum shift</span><input type="text" value="120 minutes" ${state.persona === 'doctor' ? 'disabled' : ''} /></label><label class="form-field"><span>Doctor edits</span><select ${state.persona === 'doctor' ? 'disabled' : ''}><option>Owned appointment notes only</option></select></label></div>
        </section>`;
      case 'users':
        return renderUserManagement();
      default:
        return `<section class="form-section">${sectionHeading('Doctors and services', 'Doctor and service management remain in one editor. Readable service names map to stable service keys.', button('Add doctor', { variant: 'primary', small: true, iconName: 'plus', attrs: 'data-open-modal="doctor"' }))}
          <div class="doctor-editor-card"><span class="avatar">DM</span><div class="doctor-editor-card__copy"><strong>Dr. Murugan</strong><span>MBBS, MD · General Consultation · ₹500</span></div><div class="item-actions">${status('Active', 'success')}${miniAction('Edit', { attrs: 'data-toast="Doctor editor opened"' })}</div></div>
          <div class="doctor-editor-card"><span class="avatar">PN</span><div class="doctor-editor-card__copy"><strong>Dr. Priya Nair</strong><span>MBBS, DCH · Paediatric Consultation · ₹700</span></div><div class="item-actions">${status('Active', 'success')}${miniAction('Edit', { attrs: 'data-toast="Doctor editor opened"' })}</div></div>
          <div class="doctor-editor-card"><span class="avatar">AM</span><div class="doctor-editor-card__copy"><strong>Dr. Arjun Menon</strong><span>MBBS, MS · Orthopaedic Consultation · ₹1,000</span></div><div class="item-actions">${status('Active', 'success')}${miniAction('Edit', { attrs: 'data-toast="Doctor editor opened"' })}</div></div>
        </section>
        <section class="form-section">${sectionHeading('Service mapping', 'The interface displays the name; the system retains the corresponding key and name.', status('11 predefined services', 'neutral'))}
          <div class="detail-grid"><div class="detail-field"><small>Display name</small><strong>Orthopaedic Consultation</strong></div><div class="detail-field"><small>Stored key</small><strong>orthopaedic_consultation</strong></div></div>
        </section>`;
    }
  }

  function canDeleteClinicUser(user) {
    if (!user || user.isCurrent) return false;
    if (user.role !== 'admin') return true;
    return clinicUsers.filter((candidate) => candidate.role === 'admin' && candidate.status === 'active').length > 1;
  }

  function renderUserManagement() {
    const total = clinicUsers.length;
    const doctorCount = clinicUsers.filter((user) => user.role === 'doctor').length;
    const adminCount = clinicUsers.filter((user) => user.role === 'admin').length;
    const activeCount = clinicUsers.filter((user) => user.status === 'active').length;
    const searchValue = escapeHtml(state.userSearch);

    return `<section class="user-management-panel" aria-labelledby="userManagementTitle">
      <header class="user-management-hero">
        <div class="user-management-hero__icon">${icon('shield')}</div>
        <div class="user-management-hero__copy">
          <span>Secure clinic access</span>
          <h2 id="userManagementTitle">User management</h2>
          <p>Create and manage secure logins for doctors and clinic administrators. Passwords are never visible after the one-time handoff.</p>
        </div>
        ${button('Add login', { variant: 'light', iconName: 'plus', attrs: 'data-user-create' })}
      </header>

      <div class="user-access-summary" aria-label="Login summary">
        <article><span class="user-access-summary__icon">${icon('users')}</span><div><small>Total logins</small><strong>${total}</strong><span>${doctorCount} doctors · ${adminCount} admins</span></div></article>
        <article><span class="user-access-summary__icon user-access-summary__icon--success">${icon('check')}</span><div><small>Active access</small><strong>${activeCount}</strong><span>All credentials in good standing</span></div></article>
        <article><span class="user-access-summary__icon user-access-summary__icon--gold">${icon('lock')}</span><div><small>Clinic identity</small><strong>${escapeHtml(clinicIdentity.id)}</strong><span>Locked doctor-login suffix</span></div></article>
      </div>

      <div class="user-management-toolbar">
        <label class="user-search-field">
          <span class="sr-only">Search logins</span>
          ${icon('search')}
          <input type="search" value="${searchValue}" placeholder="Search name or username" data-user-search autocomplete="off" />
        </label>
        <div class="user-filter-group" role="group" aria-label="Filter user logins">
          ${[['all', 'All'], ['doctor', 'Doctors'], ['admin', 'Clinic admins']].map(([id, label]) => `<button class="${state.userFilter === id ? 'is-active' : ''}" type="button" data-user-filter="${id}" aria-pressed="${state.userFilter === id}">${label}</button>`).join('')}
        </div>
      </div>

      <div class="user-account-table" role="table" aria-label="Clinic user logins">
        <div class="user-account-table__head" role="row">
          <span role="columnheader">User</span><span role="columnheader">Login username</span><span role="columnheader">Role</span><span role="columnheader">Access</span><span role="columnheader">Actions</span>
        </div>
        <div class="user-account-list">
          ${clinicUsers.map(renderUserAccountRow).join('')}
        </div>
        <div id="userAccountEmpty" class="user-account-empty" hidden>
          <span>${icon('search')}</span><strong>No matching logins</strong><p>Try another name, username, or role filter.</p>
        </div>
      </div>

      <footer class="user-management-footnote">
        <span>${icon('shield')}</span><div><strong>Credential safety</strong><p>Existing passwords cannot be viewed. Editing a password creates a new one-time handoff. Deleting access never removes the linked doctor profile, appointments, or clinical history.</p></div>
      </footer>
    </section>`;
  }

  function renderUserAccountRow(user) {
    const doctor = user.role === 'doctor' ? clinicDoctor(user.doctorId) : null;
    const roleLabel = user.role === 'doctor' ? 'Doctor' : 'Clinic admin';
    const initials = user.name.split(/\s+/).map((part) => part.replace(/[^A-Za-z]/g, '').charAt(0)).filter(Boolean).slice(0, 2).join('').toUpperCase();
    const searchable = `${user.name} ${user.username} ${roleLabel}`.toLowerCase();
    const deletable = canDeleteClinicUser(user);
    const deleteReason = user.isCurrent ? 'You cannot delete the login currently in use.' : 'At least one active clinic administrator is required.';
    return `<article class="user-account-row" role="row" data-user-account data-user-role="${user.role}" data-user-search-text="${escapeHtml(searchable)}">
      <div class="user-account-identity" role="cell" data-label="User">
        <span class="user-account-avatar user-account-avatar--${user.role}">${escapeHtml(initials)}</span>
        <div><strong>${escapeHtml(user.name)}</strong><span>${doctor ? escapeHtml(doctor.specialty) : user.isCurrent ? 'Signed-in clinic administrator' : 'Clinic operations access'}</span></div>
      </div>
      <div class="user-account-username" role="cell" data-label="Login username"><code>${escapeHtml(user.username)}</code><small>Updated ${escapeHtml(user.updated)}</small></div>
      <div role="cell" data-label="Role"><span class="role-badge role-badge--${user.role}">${icon(user.role === 'doctor' ? 'doctor' : 'shield')}${roleLabel}</span>${doctor ? `<small class="user-doctor-link">Linked to ${escapeHtml(doctor.name)}</small>` : ''}</div>
      <div role="cell" data-label="Access">${status(user.status === 'active' ? 'Active' : 'Paused', user.status === 'active' ? 'success' : 'warning', user.status === 'active' ? 'check' : 'alert')}</div>
      <div class="user-account-actions" role="cell" data-label="Actions">
        ${miniAction('Edit credentials', { attrs: `data-user-edit="${user.id}"` })}
        ${miniAction('Delete', { variant: 'danger', attrs: `data-user-delete="${user.id}" aria-label="Delete login for ${escapeHtml(user.name)}" title="${deletable ? 'Delete login' : escapeHtml(deleteReason)}"`, disabled: !deletable })}
      </div>
    </article>`;
  }

  function applyUserAccountFilters() {
    const query = state.userSearch.trim().toLowerCase();
    const rows = $$('[data-user-account]', appContent);
    let visible = 0;
    rows.forEach((row) => {
      const roleMatches = state.userFilter === 'all' || row.dataset.userRole === state.userFilter;
      const searchMatches = !query || row.dataset.userSearchText.includes(query);
      row.hidden = !(roleMatches && searchMatches);
      if (!row.hidden) visible += 1;
    });
    const empty = $('#userAccountEmpty', appContent);
    if (empty) empty.hidden = visible !== 0;
  }

  function sectionHeading(title, description, action = '') {
    return `<div class="form-section__heading"><div><h2>${title}</h2><p>${description}</p></div>${action}</div>`;
  }

  const settingsTabs = [
    ['agent', 'Agent settings'],
    ['notifications', 'Notifications'],
    ['languages', 'Languages'],
    ['subscription', 'Subscription & limits'],
  ];

  function renderSettings() {
    const isDoctor = state.persona === 'doctor';
    if (isDoctor && state.settingsSection !== 'languages') state.settingsSection = 'languages';
    const tabs = isDoctor ? settingsTabs.filter(([id]) => id === 'languages') : settingsTabs;
    return `${pageHeader('Preferences and account', 'Settings', isDoctor ? 'View clinic language preferences. Administrative settings remain permission restricted.' : 'Manage the AI receptionist, notifications, languages and subscription information.', state.persona === 'platform' ? status('Platform override available', 'violet') : '')}
      <div class="section-tabs" role="tablist">${tabs.map(([id, label]) => `<button class="section-tab ${state.settingsSection === id ? 'is-active' : ''}" type="button" data-settings-section="${id}">${label}</button>`).join('')}</div>
      <div id="settingsContent">${renderSettingsSection()}</div>`;
  }

  function renderSettingsSection() {
    if (state.settingsSection === 'notifications') {
      return `<section class="content-grid"><article class="panel span-8">${panelHeader('Notification policy', 'Configure when clinic staff are notified. Patient notification follows confirmation.')}
        <div class="setting-row"><div class="setting-row__copy"><strong>Notify staff for pending appointments</strong><p>Create a clinic notification when the AI receptionist records a booking that requires confirmation.</p></div><button class="toggle is-on" type="button" role="switch" aria-checked="true" data-toggle></button></div>
        <div class="setting-row"><div class="setting-row__copy"><strong>Patient confirmation</strong><p>Patients receive the applicable confirmation only after the appointment is confirmed.</p></div>${status('System managed', 'neutral', 'lock')}</div>
      </article><article class="panel span-4">${panelHeader('Recent events', 'Shown only when supplied by the API.')}${permissionNote('No channel selector', 'Notification channel selection and Test Notification are intentionally not part of this screen.', 'permission')}</article></section>`;
    }
    if (state.settingsSection === 'languages') {
      const readOnly = state.persona === 'doctor';
      return `<section class="content-grid"><article class="panel span-8">${panelHeader('Language settings', 'English remains enabled. Layouts accommodate longer translated labels.', readOnly ? status('Read only', 'neutral', 'lock') : button('Save languages', { variant: 'primary', small: true, attrs: 'data-toast="Language preferences saved in preview"' }))}
        <div class="setting-row"><div class="setting-row__copy"><strong>Default language</strong><p>The first language offered by the AI receptionist.</p></div><select class="filter-select" ${readOnly ? 'disabled' : ''}><option>English</option><option>Tanglish</option></select></div>
        <div class="setting-row"><div class="setting-row__copy"><strong>English</strong><p>Required base language and always enabled.</p></div><button class="toggle is-on" type="button" role="switch" aria-checked="true" aria-disabled="true"></button></div>
        <div class="setting-row"><div class="setting-row__copy"><strong>Tanglish</strong><p>Enabled for mixed Tamil and English conversations.</p></div><button class="toggle is-on" type="button" role="switch" aria-checked="true" ${readOnly ? 'aria-disabled="true"' : 'data-toggle'}></button></div>
        <div class="conflict-note"><span class="conflict-note__icon">${icon('alert')}</span><div><strong>Template coverage needs review</strong><p>Two optional Tanglish response templates are missing. Existing English templates remain available.</p></div></div>
      </article><article class="panel span-4">${panelHeader('Conversation coverage', 'Current readiness by language.')}<div class="metric-card"><div class="metric-card__top"><span class="metric-card__label">English</span>${status('Ready', 'success')}</div><div class="metric-card__value"><strong>100%</strong><small>required templates</small></div></div><div class="metric-card" style="margin-top:10px"><div class="metric-card__top"><span class="metric-card__label">Tanglish</span>${status('Review', 'warning')}</div><div class="metric-card__value"><strong>92%</strong><small>preview coverage</small></div></div></article></section>`;
    }
    if (state.settingsSection === 'subscription') {
      return `<section class="content-grid"><article class="panel span-8">${panelHeader('Subscription and limits', 'Plan details and operational limits from the active clinic subscription.')}
        <div class="detail-grid"><div class="detail-field"><small>Plan</small><strong>Growth Clinic</strong></div><div class="detail-field"><small>Status</small><strong>${status('Active', 'success')}</strong></div><div class="detail-field"><small>Trial end</small><strong>Not applicable</strong></div><div class="detail-field"><small>Concurrent calls</small><strong>3 calls</strong></div><div class="detail-field"><small>Voice minutes</small><strong>1,840 of 3,000</strong></div><div class="detail-field"><small>Overage</small><strong>₹2.20 / minute</strong></div><div class="detail-field"><small>Recording retention</small><strong>30 days</strong></div><div class="detail-field"><small>Transcript retention</small><strong>90 days</strong></div></div>
      </article><article class="panel span-4">${panelHeader('Usage context', 'Synthetic subscription presentation.')}<div class="prototype-note"><span class="prototype-note__icon">${icon('info')}</span><div><strong>Platform override</strong><p>Only an exact platform administrator may change plan, status, trial dates or internal notes for the active clinic.</p></div></div></article></section>`;
    }
    return `<section class="content-grid"><article class="panel span-8">${panelHeader('AI voice agent', 'Activation reflects backend readiness; this is the real settings surface.')}
      <div class="setting-row"><div class="setting-row__copy"><strong>AI voice receptionist</strong><p>Answer calls and perform approved clinic operations.</p></div><button class="toggle is-on" type="button" role="switch" aria-checked="true" data-toggle></button></div>
      <div class="setting-row"><div class="setting-row__copy"><strong>Booking mode</strong><p>Choose whether a new booking waits for clinic confirmation.</p></div><select class="filter-select"><option>Pending confirmation</option><option>Automatic confirmation</option></select></div>
      <div class="setting-row"><div class="setting-row__copy"><strong>Readiness</strong><p>Telephony, doctor mappings, schedules and knowledge checks are complete.</p></div>${status('Ready', 'success', 'check')}</div>
    </article><article class="panel span-4">${panelHeader('Settings boundary', 'Removed controls stay removed.')}${permissionNote('Intentionally excluded', 'Answering Mode and Fallback Phone are not part of this screen. Onboarding dependencies remain backend-owned.', 'permission')}</article></section>`;
  }

  function renderKnowledgeBase() {
    const tabs = [['overview', 'Overview'], ['editor', 'Manual editor'], ['review', 'Review queue'], ['approved', 'Approved knowledge'], ['import', 'DOCX import']];
    return `${pageHeader('Receptionist knowledge', 'Knowledge base', 'Draft, review and approve the safe clinic information available to the AI receptionist.', button('Add question', { variant: 'primary', iconName: 'plus', attrs: 'data-knowledge-section="editor"' }))}
      <div class="section-tabs" role="tablist">${tabs.map(([id, label]) => `<button class="section-tab ${state.knowledgeSection === id ? 'is-active' : ''}" type="button" data-knowledge-section="${id}">${label}</button>`).join('')}</div>
      <div id="knowledgeContent">${renderKnowledgeSection()}</div>`;
  }

  function renderKnowledgeSection() {
    if (state.knowledgeSection === 'editor') {
      return `<section class="content-grid"><article class="panel span-8">${panelHeader('Manual knowledge editor', 'Create a clinic answer with clear applicability and safe scope.')}
        <div class="form-grid"><label class="form-field full"><span>Question</span><input type="text" value="Is parking available near the clinic?" /></label><label class="form-field full"><span>Answer</span><textarea>Limited street parking is available. A paid parking facility is located 200 metres from the clinic entrance.</textarea></label><label class="form-field"><span>Category</span><select><option>Parking and facility</option><option>First visit and pre-visit</option><option>Insurance</option></select></label><label class="form-field"><span>Applicability</span><select><option>All callers</option></select></label><label class="form-field full"><span>Alternative phrases</span><input type="text" value="Where can I park?, Is there car parking?" /></label></div>
        <div class="item-actions" style="margin-top:18px;justify-content:flex-start">${button('Save draft', { variant: 'secondary', attrs: 'data-toast="Knowledge entry saved as draft in preview"' })}${button('Save & approve', { variant: 'primary', attrs: 'data-toast="Safety check passed in preview"' })}</div>
      </article><article class="panel span-4">${panelHeader('Medical safety', 'Unsafe clinical advice is rejected before runtime.')}${permissionNote('Knowledge boundary', 'Do not add diagnosis, medicines, dosages or treatment recommendations. Only approved and applicable entries may be answered.', 'conflict')}</article></section>`;
    }
    if (state.knowledgeSection === 'review') {
      return `<section class="panel">${panelHeader('Review queue', 'Approve, edit or disable pending and needs-update entries.', `${status('4 need review', 'warning')}${button('Approve selected', { variant: 'primary', small: true, attrs: 'data-toast="Selected entries approved in preview"' })}`)}
        <div class="item-list"><article class="knowledge-item"><label class="checkbox"><input type="checkbox" /><span></span></label><div class="item-copy"><div class="item-copy__top"><h3>What should I bring for my first visit?</h3>${status('Needs review', 'warning')}</div><p>First visit and pre-visit · Applies to all callers</p></div><div class="item-actions">${miniAction('Edit')}${miniAction('Approve', { variant: 'primary', attrs: 'data-toast="Entry approved in preview"' })}${miniAction('Disable', { variant: 'danger' })}</div></article><article class="knowledge-item"><label class="checkbox"><input type="checkbox" /><span></span></label><div class="item-copy"><div class="item-copy__top"><h3>Does the clinic accept insurance?</h3>${status('Draft', 'neutral')}</div><p>Insurance · Applicable to admin-approved plans</p></div><div class="item-actions">${miniAction('Edit')}${miniAction('Approve', { variant: 'primary', attrs: 'data-toast="Entry approved in preview"' })}${miniAction('Disable', { variant: 'danger' })}</div></article></div>
      </section>`;
    }
    if (state.knowledgeSection === 'approved') {
      return `<section class="panel">${panelHeader('Approved knowledge', 'These applicable entries may be used by the AI receptionist.', status('48 approved', 'success'))}
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Question</th><th>Category</th><th>Applicability</th><th>Embedding</th><th>Action</th></tr></thead><tbody><tr><td><strong>Where is the clinic located?</strong><small>12 Lake View Road, Chennai</small></td><td>General FAQ</td><td>All callers</td><td>${status('Ready', 'success')}</td><td>${miniAction('Edit')}${miniAction('Disable', { variant: 'danger' })}</td></tr><tr><td><strong>Is fasting required before a blood test?</strong><small>Depends on the test; contact the clinic for instructions.</small></td><td>Scan & test prep</td><td>Selected services</td><td>${status('Ready', 'success')}</td><td>${miniAction('Edit')}${miniAction('Disable', { variant: 'danger' })}</td></tr></tbody></table></div>
      </section>`;
    }
    if (state.knowledgeSection === 'import') {
      return `<section class="content-grid"><article class="panel span-8">${panelHeader('DOCX knowledge import', 'Design intent for a future reviewed import flow.', status('Prototype only', 'warning', 'alert'))}
        <div class="drop-zone"><span class="drop-zone__icon">${icon('upload')}</span><h3>Drop a clinic document here</h3><p>This visual demonstrates intended selection, processing and review states. It does not upload or import a document.</p>${button('Choose sample file', { variant: 'secondary', small: true, attrs: 'data-toast="DOCX import is not connected in this prototype"' })}</div>
      </article><article class="panel span-4">${panelHeader('Integration status', 'Honest maturity presentation.')}${permissionNote('Backend integration incomplete', 'No imported knowledge becomes available until upload, extraction, safety review and approval are explicitly implemented.', 'prototype')}</article></section>`;
    }
    return `<section class="metric-grid">${metric('Total entries', '56', 'knowledge records', 'book')}${metric('Ready', '48', 'embedded', 'check')}${metric('Pending', '6', 'processing/review', 'clock')}${metric('Failed', '2', 'needs attention', 'alert')}</section>
      <section class="content-grid"><article class="panel span-7">${panelHeader('Review readiness', 'Knowledge moves through draft, review, approval and embedding.', button('Open review queue', { variant: 'secondary', small: true, attrs: 'data-knowledge-section="review"' }))}
        <div class="timeline"><div class="timeline-event"><strong>Manual entry created</strong><span>Draft</span><p>Author provides question, answer, category, phrases and applicability.</p></div><div class="timeline-event"><strong>Human safety review</strong><span>Needs review</span><p>Clinical advice, medicine or diagnosis content is rejected.</p></div><div class="timeline-event"><strong>Approved and embedded</strong><span>Runtime ready</span><p>Only approved and applicable entries can inform caller responses.</p></div></div>
      </article><article class="panel span-5">${panelHeader('Embedding coverage', 'Synthetic design-preview values.', status('85.7%', 'info'))}<div class="prototype-note"><span class="prototype-note__icon">${icon('info')}</span><div><strong>Partial feature</strong><p>Manual Q&A and approval are live; DOCX import remains a visual prototype until backend work is authorised.</p></div></div></article></section>`;
  }

  function renderDoctorToday() {
    const selected = queue.find((item) => item.id === state.selectedQueue) || queue[0];
    return `${pageHeader('Doctor workspace', 'Today’s queue', 'A focused, ownership-scoped view of your assigned patients and consultation work.', `${status('Dr. Murugan', 'info', 'doctor')}${button('24 Sep 2026', { variant: 'secondary', small: true, iconName: 'calendar' })}`)}
      <section class="metric-grid">${metric('Waiting', '2', 'assigned', 'clock')}${metric('In progress', '1', 'current', 'doctor')}${metric('Visited', '3', 'completed', 'check')}${metric('Skipped', '0', 'today', 'arrow')}</section>
      <section class="queue-layout">
        <div class="queue-board">
          ${queueLane('Waiting', queue.filter((item) => item.status === 'Waiting'), 'warning')}
          ${queueLane('In progress', queue.filter((item) => item.status === 'In progress'), 'info')}
          ${queueLane('Visited', queue.filter((item) => item.status === 'Visited'), 'success')}
        </div>
        <aside class="consultation-card">
          <div class="patient-identity"><span class="avatar">${selected.initials}</span><div class="patient-identity__copy"><strong>${selected.name}</strong><span>${selected.time} · ${selected.service} · ${selected.visit}</span></div></div>
          ${permissionNote('Previous visit context', '12 Sep 2026 · Follow-up advice recorded. Examination details are permission scoped.', 'permission')}
          <div class="form-grid" style="margin-top:16px"><label class="form-field full"><span>Reason for visit</span><textarea>${selected.reason}</textarea></label><label class="form-field full"><span>Examination notes</span><textarea placeholder="Record examination notes"></textarea></label><label class="form-field"><span>Diagnosis</span><input type="text" placeholder="Record diagnosis" /></label><label class="form-field"><span>Advice</span><input type="text" placeholder="Record advice" /></label></div>
          <div class="item-actions" style="margin-top:18px;justify-content:flex-start">${button('Start consultation', { variant: 'secondary', small: true, attrs: 'data-toast="Local preview state: consultation started"' })}${button('Save draft', { variant: 'secondary', small: true, attrs: 'data-toast="Local preview state: draft saved"' })}${button('Mark visited', { variant: 'primary', small: true, attrs: 'data-open-modal="visit-completion"' })}</div>
          <p class="form-note" style="text-align:left;margin-top:12px">Mark Visited represents the persistent completion action. Start, Skip and Save Draft are labeled as local preview states.</p>
        </aside>
      </section>`;
  }

  function queueLane(title, items, tone) {
    return `<section class="queue-lane"><div class="queue-lane__heading"><strong>${title}</strong>${status(`${items.length} patient${items.length === 1 ? '' : 's'}`, tone)}</div><div class="item-list">${items.map((item) => `<button class="queue-item ${state.selectedQueue === item.id ? 'is-selected' : ''}" type="button" data-queue-id="${item.id}"><span class="avatar" style="width:40px;height:40px">${item.initials}</span><span class="item-copy"><span class="item-copy__top"><h3>${item.name}</h3></span><p>${item.time} · ${item.service} · ${item.reason}</p></span>${status(item.status, tone)}</button>`).join('')}</div></section>`;
  }

  function renderDoctorAnalytics() {
    return `${pageHeader('Doctor workspace', 'Analytics', 'Production-ready presentation for doctor trends. All values in this preview are intentionally marked demo.', status('Demo data · Not live', 'warning', 'alert'))}
      ${permissionNote('Do not use for clinical or operational decisions', 'The current analytics dataset is local demonstration data. Production metrics require a validated data source.', 'prototype')}
      <section class="metric-grid demo-wash" style="margin-top:18px">${metric('Visits', '—', 'awaiting live data', 'users')}${metric('Follow-ups', '—', 'awaiting live data', 'refresh')}${metric('Completion', '—', 'awaiting live data', 'check')}${metric('Avg. wait', '—', 'awaiting live data', 'clock')}</section>
      <section class="analytics-placeholder demo-wash"><article class="chart-preview">${panelHeader('Visit trend', 'Illustrative component only.', status('Demo', 'warning'))}<div class="chart-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></article><article class="panel">${panelHeader('Insight modules', 'Ready for validated production data.')}<div class="setting-row"><div class="setting-row__copy"><strong>Top conditions</strong><p>Data source required</p></div>${status('Demo', 'warning')}</div><div class="setting-row"><div class="setting-row__copy"><strong>Visit types</strong><p>Data source required</p></div>${status('Demo', 'warning')}</div><div class="setting-row"><div class="setting-row__copy"><strong>Age distribution</strong><p>Data source required</p></div>${status('Demo', 'warning')}</div></article></section>`;
  }

  function renderPlatformClinics() {
    const readOnly = state.persona === 'support';
    return `${pageHeader('Internal platform operations', 'Clinic operations', 'Review clinic lifecycle, onboarding readiness and operational status.', `${status(readOnly ? 'Support · Read only' : 'Internal only', readOnly ? 'neutral' : 'violet', 'lock')}${button('Invite clinic admin', { variant: 'primary', iconName: 'plus', attrs: 'data-open-modal="user"', disabled: readOnly })}`)}
      ${readOnly ? permissionNote('Support mutation access is not assumed', 'Activation, suspension and subscription changes remain disabled until the API explicitly authorises them.', 'permission') : ''}
      <section class="panel" style="margin-top:${readOnly ? '16px' : '0'}">${panelHeader('Clinics', 'Multi-tenant lifecycle and onboarding status.', '<span class="internal-ribbon">Vaidhyaa staff only</span>')}
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Clinic</th><th>Clinic number</th><th>Onboarding</th><th>Status</th><th>Agent</th><th>Action</th></tr></thead><tbody>
          <tr><td><strong>Sundaram Family Clinic</strong><small>Chennai, Tamil Nadu</small></td><td>VAI-CL-2048</td><td>${status('Complete', 'success')}</td><td>${status('Active', 'success')}</td><td>Ready</td><td>${miniAction('Checklist', { attrs: 'data-open-modal="onboarding"' })}${miniAction('Suspend', { variant: 'danger', attrs: 'data-open-modal="suspend"', disabled: readOnly })}</td></tr>
          <tr><td><strong>Northgate Health Centre</strong><small>Coimbatore, Tamil Nadu</small></td><td>VAI-CL-2081</td><td>${status('Needs action', 'warning')}</td><td>${status('Inactive', 'neutral')}</td><td>Not ready</td><td>${miniAction('Checklist', { attrs: 'data-open-modal="onboarding"' })}${miniAction('Activate', { variant: 'primary', attrs: 'data-toast="Clinic activation simulated"', disabled: readOnly })}</td></tr>
          <tr><td><strong>Lakeview Children’s Clinic</strong><small>Bengaluru, Karnataka</small></td><td>VAI-CL-2104</td><td>${status('Complete', 'success')}</td><td>${status('Suspended', 'danger')}</td><td>Paused</td><td>${miniAction('Checklist', { attrs: 'data-open-modal="onboarding"' })}${miniAction('Reactivate', { variant: 'primary', attrs: 'data-toast="Clinic reactivation simulated"', disabled: readOnly })}</td></tr>
        </tbody></table></div>
      </section>`;
  }

  function renderPlatformJobs() {
    return `${pageHeader('Internal platform operations', 'Job health', 'Monitor queue mode, infrastructure state and recent background job runs.', `${status('Internal only', 'violet', 'lock')}${button('Refresh health', { variant: 'secondary', iconName: 'refresh', attrs: 'data-toast="Job health refreshed"' })}`)}
      <section class="metric-grid">${metric('Queue mode', 'Redis', 'connected', 'jobs')}${metric('Pending jobs', '4', 'across queues', 'clock')}${metric('Failed jobs', '2', 'needs review', 'alert')}${metric('Last slot run', '4m', 'ago', 'refresh')}</section>
      <section class="panel">${panelHeader('Recent runs', 'Slot generation, hold expiry and retention cleanup.', status('2 failures', 'danger'))}
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Job</th><th>Clinic</th><th>Started</th><th>Duration</th><th>Status</th><th>Action</th></tr></thead><tbody><tr><td><strong>Slot generation</strong></td><td>Sundaram Family Clinic</td><td>10:02 AM</td><td>18s</td><td>${status('Succeeded', 'success')}</td><td>${miniAction('Details')}</td></tr><tr><td><strong>Knowledge embedding</strong></td><td>Northgate Health Centre</td><td>9:58 AM</td><td>42s</td><td>${status('Failed', 'danger')}</td><td>${miniAction('Retry', { variant: 'primary', attrs: 'data-toast="Job retry queued in preview"' })}</td></tr><tr><td><strong>Hold expiry</strong></td><td>All clinics</td><td>9:55 AM</td><td>3s</td><td>${status('Succeeded', 'success')}</td><td>${miniAction('Details')}</td></tr></tbody></table></div>
      </section>`;
  }

  function renderPlatformNotifications() {
    const readOnly = state.persona === 'support';
    return `${pageHeader('Internal platform operations', 'Notification operations', 'Filter, inspect and safely retry eligible notification events.', `${status(readOnly ? 'Support · Read only' : 'Internal only', readOnly ? 'neutral' : 'violet', 'lock')}`)}
      <div class="toolbar"><div class="toolbar__group"><select class="filter-select"><option>All statuses</option><option>Failed</option><option>Delivered</option></select><select class="filter-select"><option>All event types</option><option>Appointment pending</option><option>Appointment confirmed</option></select><select class="filter-select"><option>All clinics</option><option>Sundaram Family Clinic</option></select></div><div class="toolbar__group">${button('Apply filters', { variant: 'primary', small: true, attrs: 'data-toast="Notification filters applied"' })}</div></div>
      <section class="panel">${panelHeader('Notification events', 'Payload values are masked when supplied by the API.', status('7 need attention', 'warning'))}
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Clinic</th><th>Event</th><th>Channel / recipient</th><th>Status</th><th>Attempts</th><th>Action</th></tr></thead><tbody><tr><td>24 Sep · 10:08</td><td>Sundaram Family Clinic</td><td><strong>appointment.pending</strong></td><td>Email · k***@example.com</td><td>${status('Delivered', 'success')}</td><td>1</td><td>${miniAction('Payload', { attrs: 'data-open-modal="payload"' })}</td></tr><tr><td>24 Sep · 9:58</td><td>Northgate Health Centre</td><td><strong>appointment.confirmed</strong></td><td>SMS · +91 9*****2614</td><td>${status('Failed', 'danger')}</td><td>3</td><td>${miniAction('Payload', { attrs: 'data-open-modal="payload"' })}${miniAction('Retry', { variant: 'primary', attrs: 'data-toast="Notification retry simulated"', disabled: readOnly })}</td></tr></tbody></table></div>
      </section>`;
  }

  function renderCurrentPage() {
    if (state.persona === 'doctor') {
      if (state.route === 'today') return renderDoctorToday();
      if (state.route === 'analytics') return renderDoctorAnalytics();
      if (state.route === 'patient-history') return renderPatientHistory();
      if (state.route === 'clinic-setup') return renderClinicSetup();
      return renderSettings();
    }
    if (state.persona === 'platform' || state.persona === 'support') {
      if (state.route === 'platform-jobs') return renderPlatformJobs();
      if (state.route === 'platform-notifications') return renderPlatformNotifications();
      return renderPlatformClinics();
    }
    switch (state.route) {
      case 'call-inbox': return renderCallInbox();
      case 'appointments': return renderAppointments();
      case 'patient-history': return renderPatientHistory();
      case 'clinic-setup': return renderClinicSetup();
      case 'settings': return renderSettings();
      case 'knowledge-base': return renderKnowledgeBase();
      default: return renderAdminHome();
    }
  }

  function activeNavSet() {
    return state.persona === 'doctor' ? navSets.doctor : state.persona === 'platform' || state.persona === 'support' ? navSets.platform : navSets.admin;
  }

  function renderNavigation() {
    const items = activeNavSet();
    navRoot.innerHTML = items.map((item) => `<button class="nav-item ${state.route === item.id ? 'is-active' : ''}" type="button" data-route="${item.id}">${icon(item.icon)}<span>${item.label}</span>${item.badge ? `<span class="nav-item__badge">${item.badge}</span>` : ''}</button>`).join('');

    const bottomItems = items.slice(0, 3);
    mobileNav.innerHTML = `${bottomItems.map((item) => `<button class="mobile-nav-item ${state.route === item.id ? 'is-active' : ''}" type="button" data-route="${item.id}">${icon(item.icon)}<span>${item.label}</span></button>`).join('')}<button class="mobile-nav-item" type="button" data-open-mobile-nav>${icon('more')}<span>More</span></button>`;
  }

  function renderApp({ focus = false } = {}) {
    const isInternal = state.persona === 'platform' || state.persona === 'support';
    portalExperience.classList.toggle('internal-shell', isInternal);
    $('#clinicCard').hidden = isInternal;
    $('#shellDescriptor').textContent = isInternal ? 'Internal platform operations' : state.persona === 'doctor' ? 'Doctor workspace' : 'AI clinic operations';
    $('#signedInRole').textContent = state.persona === 'admin' ? 'Clinic administrator' : state.persona === 'doctor' ? 'Doctor' : state.persona === 'support' ? 'Support · read only' : 'Platform administrator';
    $('#breadcrumbScope').textContent = isInternal ? 'Vaidhyaa Platform' : state.persona === 'doctor' ? 'Dr. Murugan' : 'Sundaram Family Clinic';
    $('#breadcrumbPage').textContent = routeTitles[state.route] || 'Workspace';
    personaSelect.value = state.persona;
    renderNavigation();
    appContent.innerHTML = `<div class="page-enter">${renderCurrentPage()}</div>`;
    if (state.route === 'clinic-setup' && state.setupSection === 'users') applyUserAccountFilters();
    if (focus) appContent.focus({ preventScroll: true });
  }

  function enterPortal(persona = 'admin') {
    state.persona = persona;
    state.route = persona === 'doctor' ? 'today' : persona === 'platform' || persona === 'support' ? 'platform-clinics' : 'home';
    state.setupSection = persona === 'doctor' ? 'schedules' : 'doctors';
    state.settingsSection = persona === 'doctor' ? 'languages' : 'agent';
    authExperience.classList.add('is-hidden');
    portalExperience.classList.remove('is-hidden');
    document.body.classList.remove('nav-open');
    window.scrollTo({ top: 0, behavior: 'instant' });
    updateHash();
    renderApp({ focus: true });
  }

  function returnToLogin() {
    closeModal();
    portalExperience.classList.add('is-hidden');
    authExperience.classList.remove('is-hidden');
    document.body.classList.remove('nav-open');
    location.hash = 'top';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function navigate(route) {
    state.route = route;
    document.body.classList.remove('nav-open');
    $('#mobileScrim').hidden = true;
    updateHash();
    renderApp({ focus: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateHash() {
    history.replaceState(null, '', `#app/${state.persona}/${state.route}`);
  }

  function syncFromHash() {
    const match = location.hash.match(/^#app\/(admin|doctor|platform|support)\/([a-z-]+)$/);
    if (!match) return;
    const [, persona, route] = match;
    const valid = (persona === 'admin' ? navSets.admin : persona === 'doctor' ? navSets.doctor : navSets.platform).some((item) => item.id === route);
    if (!valid) return;
    state.persona = persona;
    state.route = route;
    authExperience.classList.add('is-hidden');
    portalExperience.classList.remove('is-hidden');
    renderApp();
  }

  function syncPreviewFromQuery() {
    const preview = new URLSearchParams(location.search).get('preview');
    const targets = {
      'admin-home': ['admin', 'home'],
      appointments: ['admin', 'appointments'],
      'call-inbox': ['admin', 'call-inbox'],
      doctor: ['doctor', 'today'],
      platform: ['platform', 'platform-clinics'],
      'clinic-users': ['admin', 'clinic-setup', 'users'],
      'clinic-user-create': ['admin', 'clinic-setup', 'users', 'create'],
      'clinic-user-create-admin': ['admin', 'clinic-setup', 'users', 'create-admin'],
      'clinic-user-edit': ['admin', 'clinic-setup', 'users', 'edit'],
      'clinic-user-credentials': ['admin', 'clinic-setup', 'users', 'credentials'],
      'clinic-user-delete': ['admin', 'clinic-setup', 'users', 'delete'],
    };
    if (!targets[preview]) return false;
    const [persona, route, setupSection, userPreview] = targets[preview];
    state.persona = persona;
    state.route = route;
    state.setupSection = setupSection || (state.persona === 'doctor' ? 'schedules' : 'doctors');
    state.settingsSection = state.persona === 'doctor' ? 'languages' : 'agent';
    authExperience.classList.add('is-hidden');
    portalExperience.classList.remove('is-hidden');
    renderApp();
    if (userPreview) requestAnimationFrame(() => {
      if (userPreview === 'create') return openUserFlow('create', '', null, { preselectDoctor: true });
      if (userPreview === 'create-admin') return openUserFlow('create', '', null, { role: 'admin' });
      if (userPreview === 'edit') return openUserFlow('edit', 'user-doctor-arjun', null);
      if (userPreview === 'delete') return openUserFlow('delete', 'user-doctor-arjun', null);
      state.userModal = {
        mode: 'create', userId: '', role: 'doctor', step: 'credentials', selectedDoctorId: 'doctor-priya', usernameStem: 'priya_nair', adminUsername: '',
        credentials: { name: 'Dr. Priya Nair', username: 'priya_nair.VAI-CL-2048', password: 'Clinic#4826', isReset: false },
      };
      openModal('user-create', null);
    });
    return true;
  }

  function showToast(title, message = 'This interaction is simulated in the isolated design preview.') {
    const node = document.createElement('div');
    node.className = 'toast';
    node.innerHTML = `<span class="toast__icon">${icon('check')}</span><div><strong>${title}</strong><span>${message}</span></div><button type="button" aria-label="Dismiss notification">${icon('x')}</button>`;
    $('button', node).addEventListener('click', () => node.remove());
    toastRegion.append(node);
    window.setTimeout(() => node.remove(), 5000);
  }

  function modalShell(title, description, body, footer, wide = false) {
    return `<div class="modal-backdrop" data-modal-backdrop>
      <section class="modal ${wide ? 'modal--wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modalTitle" aria-describedby="modalDescription">
        <header class="modal__header"><div><h2 id="modalTitle">${title}</h2><p id="modalDescription">${description}</p></div><button class="icon-button icon-button--surface" type="button" data-close-modal aria-label="Close dialog">${icon('x')}</button></header>
        <div class="modal__body">${body}</div>
        ${footer ? `<footer class="modal__footer">${footer}</footer>` : ''}
      </section>
    </div>`;
  }

  function openModal(type, trigger = document.activeElement) {
    state.modalTrigger = trigger;
    state.modalStep = 1;
    state.modalType = type;
    modalRoot.innerHTML = modalFor(type);
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => ($('[data-modal-initial-focus]', modalRoot) || $('[data-close-modal]', modalRoot))?.focus());
  }

  function closeModal({ restoreFocus = true } = {}) {
    if (!modalRoot.innerHTML) return;
    const trigger = state.modalTrigger;
    modalRoot.innerHTML = '';
    document.body.classList.remove('modal-open');
    state.modalTrigger = null;
    state.modalType = null;
    state.userModal = null;
    if (restoreFocus && trigger?.isConnected) trigger.focus?.();
  }

  function focusUserManagementTarget(userId = '') {
    requestAnimationFrame(() => {
      const target = userId ? $(`[data-user-edit="${userId}"]`, appContent) : $('[data-user-create]', appContent);
      target?.focus?.();
    });
  }

  function openUserFlow(mode, userId = '', trigger = document.activeElement, options = {}) {
    const user = userId ? clinicUser(userId) : null;
    if ((mode === 'edit' || mode === 'delete') && !user) return;
    if (mode === 'delete' && !canDeleteClinicUser(user)) {
      return showToast('This login is protected', user?.isCurrent ? 'You cannot delete the account currently in use.' : 'At least one active clinic administrator is required.');
    }

    const role = user?.role || options.role || 'doctor';
    const availableDoctors = eligibleDoctors(userId);
    const selectedDoctorId = user?.doctorId || (options.preselectDoctor ? availableDoctors[0]?.id || '' : '');
    const selectedDoctor = clinicDoctor(selectedDoctorId);
    const suffix = `.${clinicIdentity.id}`;
    const existingStem = user?.role === 'doctor' && user.username.endsWith(suffix) ? user.username.slice(0, -suffix.length) : '';

    state.userModal = {
      mode,
      userId,
      role,
      step: mode === 'delete' ? 'delete' : 'form',
      selectedDoctorId,
      usernameStem: existingStem || (selectedDoctor ? usernameStemForDoctor(selectedDoctor.name) : ''),
      adminUsername: user?.role === 'admin' ? user.username : '',
      credentials: null,
    };
    openModal(`user-${mode}`, trigger);
  }

  function userManagementModal(type) {
    const modalState = state.userModal;
    if (!modalState) return modalShell('User management', 'Return to the user list and choose an action.', permissionNote('No account selected', 'This isolated preview has no user context for the requested action.', 'prototype'), button('Close', { variant: 'primary', attrs: 'data-close-modal' }));
    if (modalState.step === 'credentials') return userCredentialsModal();
    if (type === 'user-delete' || modalState.step === 'delete') return userDeleteModal();
    return userAccountFormModal();
  }

  function userRoleSelector(role, editing) {
    if (editing) return '';
    return `<div class="user-role-selector" role="group" aria-label="Login role">
      <button class="${role === 'doctor' ? 'is-active' : ''}" type="button" data-user-role-choice="doctor" aria-pressed="${role === 'doctor'}" data-modal-initial-focus>${icon('doctor')}<span><strong>Doctor</strong><small>Linked clinical access</small></span>${role === 'doctor' ? icon('check') : ''}</button>
      <button class="${role === 'admin' ? 'is-active' : ''}" type="button" data-user-role-choice="admin" aria-pressed="${role === 'admin'}">${icon('shield')}<span><strong>Clinic admin</strong><small>Operations &amp; setup</small></span>${role === 'admin' ? icon('check') : ''}</button>
    </div>`;
  }

  function passwordField(label, name, helper = '') {
    const errorId = `${name}Error`;
    return `<label class="form-field user-password-field"><span>${label}</span><span class="user-password-input"><input type="password" name="${name}" autocomplete="new-password" aria-describedby="${errorId}${helper ? ` ${name}Helper` : ''}" /><button type="button" data-password-toggle="${name}" aria-label="Show ${label.toLowerCase()}">${icon('eye')}</button></span>${helper ? `<small id="${name}Helper" class="field-helper">${helper}</small>` : ''}<small id="${errorId}" class="field-error" data-user-error="${name}" hidden></small></label>`;
  }

  function userAccountFormModal() {
    const modalState = state.userModal;
    const editing = modalState.mode === 'edit';
    const user = editing ? clinicUser(modalState.userId) : null;
    const role = modalState.role;
    const availableDoctors = eligibleDoctors(modalState.userId);
    const selectedDoctor = clinicDoctor(modalState.selectedDoctorId);
    const title = editing ? 'Edit login credentials' : 'Add a new login';
    const description = editing ? 'Update the username or set a new password. Existing passwords are never displayed.' : 'Create secure access for a doctor or another clinic administrator.';
    const identity = editing ? `<div class="user-edit-context"><span class="user-account-avatar user-account-avatar--${role}">${escapeHtml(user.name.split(/\s+/).map((part) => part.replace(/[^A-Za-z]/g, '').charAt(0)).filter(Boolean).slice(0, 2).join('').toUpperCase())}</span><div><small>Editing access for</small><strong>${escapeHtml(user.name)}</strong><span>${role === 'doctor' ? `Doctor · ${escapeHtml(clinicDoctor(user.doctorId)?.specialty || '')}` : 'Clinic administrator'}</span></div>${status(role === 'doctor' ? 'Doctor' : 'Clinic admin', role === 'doctor' ? 'info' : 'violet')}</div>` : '';

    let accountFields = '';
    if (role === 'doctor') {
      const options = availableDoctors.map((doctor) => `<option value="${doctor.id}" ${doctor.id === modalState.selectedDoctorId ? 'selected' : ''}>${escapeHtml(doctor.name)} · ${escapeHtml(doctor.specialty)}</option>`).join('');
      accountFields = `${editing ? '' : `<label class="form-field full"><span>Doctor</span><select data-user-doctor name="doctorId" aria-describedby="doctorIdError" ${availableDoctors.length ? '' : 'disabled'}><option value="">Select an eligible doctor</option>${options}</select><small id="doctorIdError" class="field-error" data-user-error="doctorId" hidden></small>${availableDoctors.length ? '<small class="field-helper">Only active doctors without an existing login are shown.</small>' : '<small class="field-error is-static">Every active doctor already has a login.</small>'}</label>`}
        <div class="form-field full"><span>Login username</span><div class="compound-username ${selectedDoctor || editing ? '' : 'is-disabled'}"><input type="text" name="usernameStem" value="${escapeHtml(modalState.usernameStem)}" placeholder="doctor_name" autocomplete="off" aria-label="Editable doctor username" aria-describedby="usernameStemError clinicSuffixNote" ${selectedDoctor || editing ? '' : 'disabled'} data-username-stem ${editing ? 'data-modal-initial-focus' : ''} /><span aria-label="Locked clinic ID suffix">.${escapeHtml(clinicIdentity.id)} ${icon('lock')}</span></div><small id="clinicSuffixNote" class="field-helper">The clinic ID suffix is added automatically and cannot be changed.</small><small id="usernameStemError" class="field-error" data-user-error="usernameStem" hidden></small><div class="username-preview"><span>${icon('user')}Login username</span><code data-username-preview>${escapeHtml(doctorUsername(modalState.usernameStem || 'doctor_name'))}</code></div></div>`;
    } else {
      accountFields = `<label class="form-field full"><span>Administrator username</span><input type="text" name="adminUsername" value="${escapeHtml(modalState.adminUsername)}" placeholder="admin_name" autocomplete="off" aria-describedby="adminUsernameError adminUsernameHelper" data-admin-username ${editing ? 'data-modal-initial-focus' : ''} /><small id="adminUsernameHelper" class="field-helper">Use a memorable, clinic-specific username. The clinic ID is not appended to administrator accounts.</small><small id="adminUsernameError" class="field-error" data-user-error="adminUsername" hidden></small></label>`;
    }

    const passwordHelper = editing ? 'Leave both password fields blank to keep the current password.' : 'Use at least 8 characters with letters and numbers.';
    const body = `<div class="modal-security-kicker">${icon('shield')}Secure clinic access</div>${userRoleSelector(role, editing)}${identity}<div id="userFormAlert" class="form-alert" role="alert" hidden></div><form id="userLoginForm" class="user-login-form" novalidate><div class="form-grid">${accountFields}${passwordField(editing ? 'New password' : 'Password', 'password', passwordHelper)}${passwordField(editing ? 'Confirm new password' : 'Confirm password', 'confirmPassword')}</div><div class="password-requirements ${editing ? 'is-optional' : ''}"><span>${editing ? 'New password readiness · optional' : 'Password readiness'}</span><ul aria-hidden="true"><li data-password-rule="length">8+ characters</li><li data-password-rule="letter">Contains a letter</li><li data-password-rule="number">Contains a number</li><li data-password-rule="match">Passwords match</li></ul><p class="sr-only" data-password-status aria-live="polite">${editing ? 'No new password entered. The current password will be kept.' : 'Enter a password to check its readiness.'}</p></div></form>${permissionNote('Prototype safety boundary', 'This workflow updates synthetic in-memory records only. No production identity or clinic record is changed.', 'prototype')}`;
    const footer = `${button('Cancel', { variant: 'secondary', attrs: 'data-close-modal' })}${button(editing ? 'Save changes' : 'Create login', { variant: 'primary', iconName: editing ? 'check' : 'plus', type: 'submit', attrs: 'data-user-save form="userLoginForm"' })}`;
    return modalShell(title, description, body, footer);
  }

  function userCredentialsModal() {
    const credentials = state.userModal.credentials;
    if (!credentials) return modalShell('Credentials unavailable', 'This one-time credential handoff has already been closed.', permissionNote('Password protected', 'Return to the user list and use Edit credentials to set a new password.', 'permission'), button('Return to user list', { variant: 'primary', attrs: 'data-user-credentials-done' }));
    const title = credentials.isReset ? 'Password updated successfully' : 'Login created successfully';
    return modalShell(title, 'Share these credentials securely. The password is shown only in this confirmation.', `<div class="credential-success">
      <div class="credential-success__mark">${icon('check')}</div>
      <span>Credentials ready</span>
      <h3>${escapeHtml(credentials.name)} can now sign in</h3>
      <p>Copy the credentials now. After this window closes, the password cannot be viewed again.</p>
    </div>
    <div class="credential-handoff">
      <div class="credential-handoff__row"><div><small>Username</small><code>${escapeHtml(credentials.username)}</code></div><button type="button" data-user-copy="username" aria-label="Copy username">${icon('clipboard')}Copy</button></div>
      <div class="credential-handoff__row credential-handoff__row--password"><div><small>Temporary password</small><code>${escapeHtml(credentials.password)}</code></div><button type="button" data-user-copy="password" aria-label="Copy temporary password">${icon('clipboard')}Copy</button></div>
    </div>
    <button class="copy-all-credentials" type="button" data-user-copy="both">${icon('clipboard')}Copy username and password</button>
    ${permissionNote('Shown once for security', 'Ask the user to sign in and change this temporary password through password recovery. Do not send it through an unsecured public channel.', 'permission')}`, button("I've saved these credentials", { variant: 'primary', iconName: 'check', attrs: 'data-user-credentials-done data-modal-initial-focus' }));
  }

  function userDeleteModal() {
    const user = clinicUser(state.userModal.userId);
    if (!user) return modalShell('Login unavailable', 'The selected login no longer exists in this preview.', '', button('Close', { variant: 'primary', attrs: 'data-close-modal' }));
    const doctor = user.role === 'doctor' ? clinicDoctor(user.doctorId) : null;
    const preserved = doctor ? 'The doctor profile, appointments, schedules, and clinical history will be preserved.' : 'Clinic configuration and operational records will be preserved.';
    return modalShell('Delete this login?', `Access for ${escapeHtml(user.name)} will be revoked immediately in this simulated flow.`, `<div class="delete-login-summary">
      <span class="delete-login-summary__icon">${icon('trash')}</span>
      <div><small>Login being removed</small><strong>${escapeHtml(user.name)}</strong><code>${escapeHtml(user.username)}</code></div>
    </div>
    <div class="danger-callout">${icon('alert')}<div><strong>This removes access only</strong><p>${escapeHtml(preserved)} The password and username will no longer work.</p></div></div>
    <label class="delete-confirmation-check"><input type="checkbox" data-delete-acknowledgement /><span>I understand that this login will be permanently removed.</span></label>`, `${button('Keep login', { variant: 'secondary', attrs: 'data-close-modal data-modal-initial-focus' })}${button('Delete login', { variant: 'danger', iconName: 'trash', attrs: 'data-user-delete-confirm disabled' })}`);
  }

  function modalFor(type) {
    const cancel = button('Cancel', { variant: 'secondary', attrs: 'data-close-modal' });
    if (type === 'manual-booking') return manualBookingModal();
    if (type.startsWith('user-')) return userManagementModal(type);
    if (type === 'patient-history') {
      return modalShell('Meera Raman · Full history', 'Combined appointment and completed-visit timeline. Synthetic preview record.', `<div class="patient-identity"><span class="avatar">MR</span><div class="patient-identity__copy"><strong>Meera Raman</strong><span>+91 90000 05214 · Age 36 · Female</span></div></div><div class="timeline"><div class="timeline-event"><strong>Completed visit · Dr. Murugan</strong><span>12 Sep 2026 · General consultation · Visited</span><p>Reason: Fatigue review<br />Examination: Not recorded<br />Diagnosis: Not recorded<br />Advice: Continue follow-up as discussed.</p></div><div class="timeline-event"><strong>Appointment confirmed</strong><span>10 Sep 2026 · General consultation</span><p>Booked by the AI voice receptionist after explicit confirmation.</p></div><div class="timeline-event"><strong>Completed visit · Dr. Murugan</strong><span>18 Jul 2026 · General consultation · Visited</span><p>Clinical detail shown only where permitted.</p></div></div>`, button('Close history', { variant: 'primary', attrs: 'data-close-modal' }), true);
    }
    if (type === 'clinic-profile') {
      return modalShell('Clinic profile', 'Edit public clinic details. System identifiers remain immutable.', `<div class="form-grid"><label class="form-field full"><span>Clinic name</span><input type="text" value="Sundaram Family Clinic" /></label><label class="form-field"><span>Clinic phone</span><input type="tel" value="+91 90000 00010" /></label><label class="form-field"><span>Unique clinic number</span><input type="text" value="VAI-CL-2048" disabled /></label><label class="form-field full"><span>Address</span><input type="text" value="12 Lake View Road" /></label><label class="form-field"><span>City</span><input type="text" value="Chennai" /></label><label class="form-field"><span>State</span><input type="text" value="Tamil Nadu" /></label><label class="form-field"><span>Postal code</span><input type="text" value="600042" /></label><label class="form-field"><span>Country</span><input type="text" value="India" /></label></div>${permissionNote('Immutable system fields', 'Clinic ID, unique clinic number, tenant ownership and internal identifiers cannot be edited.', 'permission')}`, `${cancel}${button('Save profile', { variant: 'primary', attrs: 'data-modal-success="Clinic profile saved"' })}`);
    }
    if (type === 'recovery') {
      return modalShell('Recover your password', 'Verify the registered email, enter the one-time code and create a new password.', `<div class="modal-steps"><span class="modal-step is-active" data-step="1">Email</span><span class="modal-step" data-step="2">Verify</span><span class="modal-step" data-step="3">Reset</span></div><label class="form-field"><span>Registered email</span><input type="email" value="preview@vaidhyaa.example" /></label><p class="form-note" style="text-align:left;margin-top:10px">The production flow includes sending, invalid email, expired code, resend, password validation and success states.</p>`, `${cancel}${button('Send verification code', { variant: 'primary', attrs: 'data-modal-success="Verification step previewed"' })}`);
    }
    if (type === 'reschedule') {
      return modalShell('Edit date and time', 'Load valid slots for the same doctor and service, then recheck capacity before saving.', `<div class="detail-grid"><div class="detail-field"><small>Patient</small><strong>Rohan Iyer</strong></div><div class="detail-field"><small>Doctor & service</small><strong>Dr. Murugan · General consultation</strong></div></div><div class="form-grid" style="margin-top:16px"><label class="form-field"><span>New date</span><input type="date" value="2026-09-26" /></label><label class="form-field"><span>Current appointment</span><input type="text" value="24 Sep · 11:00 AM" disabled /></label><div class="form-field full"><span>Available database slots</span><div class="slot-grid"><button class="slot" type="button">9:00 AM</button><button class="slot" type="button">9:30 AM</button><button class="slot is-selected" type="button">10:00 AM</button><button class="slot" type="button">10:30 AM</button><button class="slot" type="button" disabled>11:00 AM · Full</button><button class="slot" type="button">11:30 AM</button></div></div></div>${permissionNote('Live capacity check on save', 'The new slot is reserved only if capacity remains available; then the original slot is released and the activity is recorded.', 'conflict')}`, `${cancel}${button('Save new time', { variant: 'primary', attrs: 'data-modal-success="Appointment rescheduled"' })}`, true);
    }
    if (type === 'visit-completion') {
      return modalShell('Complete consultation', 'Marking this owned appointment visited creates the patient visit record.', `<div class="patient-identity"><span class="avatar">RI</span><div class="patient-identity__copy"><strong>Rohan Iyer</strong><span>General consultation · Persistent cough · New patient</span></div></div><div class="form-grid"><label class="form-field full"><span>Examination notes</span><textarea placeholder="Record examination findings"></textarea></label><label class="form-field"><span>Diagnosis</span><input type="text" placeholder="Record diagnosis" /></label><label class="form-field"><span>Advice</span><input type="text" placeholder="Record advice" /></label></div>`, `${cancel}${button('Mark visited', { variant: 'primary', attrs: 'data-modal-success="Visit completed"' })}`);
    }
    if (type === 'outcome-filter') {
      return modalShell('Filter call outcomes', 'Choose one or more outcomes. The trigger will show the selected count.', `<div class="item-list">${['Appointment booked', 'Cancelled appointment', 'Appointment rescheduled', 'General inquiry', 'Callback requested', 'Emergency'].map((label, index) => `<label class="setting-row" style="min-height:48px"><span class="checkbox"><input type="checkbox" ${index < 3 ? 'checked' : ''} /><span>${label}</span></span></label>`).join('')}</div>`, `${cancel}${button('Apply 3 outcomes', { variant: 'primary', attrs: 'data-modal-success="Call outcome filter applied"' })}`);
    }
    if (type === 'onboarding') {
      return modalShell('Clinic onboarding checklist', 'Operational readiness across required clinic configuration.', `<div class="item-list">${['Clinic details', 'Administrator access', 'Working hours', 'Doctors and services', 'Service mappings', 'Doctor schedules', 'Booking rules', 'Approved knowledge', 'Telephony', 'Test conversation'].map((label, index) => `<div class="setting-row"><div class="setting-row__copy"><strong>${label}</strong><p>${index === 8 ? 'Provider number still required' : 'Configuration verified'}</p></div>${index === 8 ? status('Needs action', 'warning') : status('Complete', 'success', 'check')}</div>`).join('')}</div>`, button('Close checklist', { variant: 'primary', attrs: 'data-close-modal' }), true);
    }
    if (type === 'request-review') {
      return modalShell('Review change request', 'Compare the original appointment and the requested change before deciding.', `<div class="detail-grid"><div class="detail-field"><small>Original</small><strong>25 Sep · 4:30 PM</strong></div><div class="detail-field"><small>Requested</small><strong>27 Sep · 5:30 PM</strong></div><div class="detail-field"><small>Doctor</small><strong>Dr. Arjun Menon</strong></div><div class="detail-field"><small>Service</small><strong>Orthopaedic consultation</strong></div></div>${permissionNote('Capacity available', 'The requested slot is currently valid. Capacity will be checked again when approved.', 'prototype')}`, `${button('Reject request', { variant: 'danger', attrs: 'data-modal-success="Request rejected; original retained"' })}${button('Choose another slot', { variant: 'secondary', attrs: 'data-open-modal="reschedule"' })}${button('Approve request', { variant: 'primary', attrs: 'data-modal-success="Reschedule request approved"' })}`);
    }
    if (type === 'payload') {
      return modalShell('Masked notification payload', 'Sensitive recipient values remain protected in the internal operations view.', `<pre style="overflow:auto;border-radius:14px;padding:16px;color:#dceee8;background:#0b1220;font-size:11px;line-height:1.6">{
  "event": "appointment.confirmed",
  "clinic": "VAI-CL-****",
  "recipient": "+91 9*****2614",
  "appointment": "APT-****",
  "request_id": "req_preview_1048"
}</pre>`, button('Close payload', { variant: 'primary', attrs: 'data-close-modal' }));
    }
    const labels = {
      'cancel-confirmation': ['Cancel appointment?', 'This action changes the appointment lifecycle. Confirm the reason before continuing.', 'Cancel appointment'],
      'delete-confirmation': ['Remove this item?', 'Existing appointments are checked before configuration is removed.', 'Remove'],
      suspend: ['Suspend clinic?', 'Clinic access and voice operations will pause. This is an internal platform action.', 'Suspend clinic'],
      holiday: ['Add clinic holiday', 'Choose the date, reason and affected doctors. Conflicts block saving.', 'Add holiday'],
      user: ['Create clinic user', 'Create a clinic administrator or link a doctor login to an unlinked doctor.', 'Create user'],
      doctor: ['Add doctor and service', 'Doctors and predefined services remain in one editor.', 'Add doctor'],
    };
    const [title, description, action] = labels[type] || ['Preview interaction', 'This is a simulated state in the isolated design prototype.', 'Continue'];
    return modalShell(title, description, `<div class="form-grid"><label class="form-field full"><span>${type.includes('cancel') || type === 'suspend' ? 'Reason' : 'Name or detail'}</span><textarea placeholder="Enter the required information"></textarea></label></div>${permissionNote('Preview only', 'No production record is changed by this interaction.', 'prototype')}`, `${cancel}${button(action, { variant: type.includes('cancel') || type === 'suspend' || type.includes('delete') ? 'danger' : 'primary', attrs: `data-modal-success="${action} simulated"` })}`);
  }

  function manualBookingModal() {
    let body = '';
    let footer = '';
    if (state.modalStep === 1) {
      body = `<div class="modal-steps"><span class="modal-step is-active" data-step="1">Patient</span><span class="modal-step" data-step="2">Appointment</span><span class="modal-step" data-step="3">Review</span></div><div class="form-grid"><label class="form-field"><span>Patient name</span><input type="text" value="Ananya Rao" /></label><label class="form-field"><span>Patient phone</span><input type="tel" value="+91 90000 01427" /></label><label class="form-field"><span>Age</span><input type="number" min="0" max="130" value="8" /></label><label class="form-field"><span>Date of birth</span><input type="date" value="2018-03-12" /></label></div><div class="prototype-note" style="margin-top:16px"><span class="prototype-note__icon">${icon('search')}</span><div><strong>Existing-patient match</strong><p>A synthetic patient with the same phone number was found. The appointment will use the existing patient record.</p></div></div>`;
      footer = `${button('Close', { variant: 'secondary', attrs: 'data-close-modal' })}${button('Continue', { variant: 'primary', attrs: 'data-booking-next' })}`;
    } else if (state.modalStep === 2) {
      body = `<div class="modal-steps"><span class="modal-step is-complete" data-step="1">Patient</span><span class="modal-step is-active" data-step="2">Appointment</span><span class="modal-step" data-step="3">Review</span></div><div class="form-grid"><label class="form-field"><span>Doctor</span><select><option>Dr. Priya Nair</option><option>Dr. Murugan</option></select></label><label class="form-field"><span>Active service</span><select><option>Paediatric Consultation</option></select></label><label class="form-field"><span>Clinic date</span><input type="date" value="2026-09-25" /></label><label class="form-field"><span>Visit type</span><select><option>Follow-up</option><option>New patient</option></select></label><label class="form-field full"><span>Available database slot</span><div class="slot-grid"><button class="slot" type="button">9:00 AM</button><button class="slot" type="button">9:30 AM</button><button class="slot is-selected" type="button">10:30 AM</button><button class="slot" type="button">11:00 AM</button><button class="slot" type="button" disabled>11:30 AM · Full</button><button class="slot" type="button">12:00 PM</button></div></label><label class="form-field full"><span>Reason for visit</span><textarea>Fever follow-up and review</textarea></label></div><label class="checkbox" style="margin-top:14px"><input type="checkbox" /><span>Override clinic hours (administrator only; requires reason and still enforces capacity)</span></label>`;
      footer = `${button('Back', { variant: 'secondary', attrs: 'data-booking-back' })}${button('Review booking', { variant: 'primary', attrs: 'data-booking-next' })}`;
    } else {
      body = `<div class="modal-steps"><span class="modal-step is-complete" data-step="1">Patient</span><span class="modal-step is-complete" data-step="2">Appointment</span><span class="modal-step is-active" data-step="3">Review</span></div><div class="detail-grid"><div class="detail-field"><small>Patient</small><strong>Ananya Rao · Age 8</strong></div><div class="detail-field"><small>Phone</small><strong>+91 90000 01427</strong></div><div class="detail-field"><small>Doctor</small><strong>Dr. Priya Nair</strong></div><div class="detail-field"><small>Service</small><strong>Paediatric Consultation</strong></div><div class="detail-field"><small>Date & time</small><strong>25 Sep · 10:30 AM</strong></div><div class="detail-field"><small>Visit type</small><strong>Follow-up</strong></div></div>${permissionNote('Availability rechecked on create', 'The selected slot remains subject to live capacity, working hours, holidays and double-booking protection.', 'conflict')}`;
      footer = `${button('Back', { variant: 'secondary', attrs: 'data-booking-back' })}${button('Create appointment', { variant: 'primary', attrs: 'data-modal-success="Appointment created"' })}`;
    }
    return modalShell('Add manual appointment', 'The same validated workflow is used from Home and Appointments.', body, footer, true);
  }

  function refreshModal(type = state.modalType || 'manual-booking', focusSelector = '[data-modal-initial-focus]') {
    state.modalType = type;
    modalRoot.innerHTML = modalFor(type);
    requestAnimationFrame(() => ($(focusSelector, modalRoot) || $('[data-close-modal]', modalRoot))?.focus());
  }

  function validateLoginUsername(value, currentUserId = '') {
    const username = value.trim();
    if (!username) return 'Enter a username.';
    if (username.length < 3 || username.length > 64) return 'Use between 3 and 64 characters.';
    if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i.test(username)) return 'Use letters, numbers, underscores, hyphens, or periods. Start and end with a letter or number.';
    if (clinicUsers.some((user) => user.id !== currentUserId && user.username.toLowerCase() === username.toLowerCase())) return 'This username is already in use. Choose another.';
    return '';
  }

  function showUserFormErrors(errors) {
    $$('[data-user-error]', modalRoot).forEach((node) => {
      node.hidden = true;
      node.textContent = '';
    });
    $$('input, select', $('#userLoginForm', modalRoot)).forEach((node) => node.removeAttribute('aria-invalid'));
    Object.entries(errors).forEach(([field, message]) => {
      const error = $(`[data-user-error="${field}"]`, modalRoot);
      const input = $(`[name="${field}"]`, modalRoot);
      if (error) { error.textContent = message; error.hidden = false; }
      if (input) input.setAttribute('aria-invalid', 'true');
    });
    const alert = $('#userFormAlert', modalRoot);
    if (alert) {
      const count = Object.keys(errors).length;
      alert.hidden = count === 0;
      alert.textContent = count ? `Please correct ${count} ${count === 1 ? 'field' : 'fields'} before continuing.` : '';
    }
    const firstInvalid = $('[aria-invalid="true"]', modalRoot);
    firstInvalid?.focus();
  }

  function updatePasswordReadiness() {
    const password = $('[name="password"]', modalRoot)?.value || '';
    const confirmation = $('[name="confirmPassword"]', modalRoot)?.value || '';
    const editing = state.userModal?.mode === 'edit';
    const rules = {
      length: password.length >= 8,
      letter: /[A-Za-z]/.test(password),
      number: /\d/.test(password),
      match: Boolean(password) && password === confirmation,
    };
    Object.entries(rules).forEach(([rule, ready]) => {
      const node = $(`[data-password-rule="${rule}"]`, modalRoot);
      if (node) node.classList.toggle('is-ready', ready);
    });
    const statusNode = $('[data-password-status]', modalRoot);
    if (statusNode) {
      if (!password && !confirmation && editing) statusNode.textContent = 'No new password entered. The current password will be kept.';
      else {
        const met = Object.values(rules).filter(Boolean).length;
        statusNode.textContent = met === 4 ? 'Password is ready and both entries match.' : `${met} of 4 password requirements met.`;
      }
    }
  }

  function updateDoctorUsernamePreview() {
    const input = $('[data-username-stem]', modalRoot);
    const preview = $('[data-username-preview]', modalRoot);
    if (!input || !preview) return;
    state.userModal.usernameStem = input.value;
    preview.textContent = doctorUsername(input.value.trim() || 'doctor_name');
  }

  function saveUserLogin() {
    const form = $('#userLoginForm', modalRoot);
    const modalState = state.userModal;
    if (!form || !modalState) return;
    const data = new FormData(form);
    const editing = modalState.mode === 'edit';
    const existing = editing ? clinicUser(modalState.userId) : null;
    const role = modalState.role;
    const password = String(data.get('password') || '');
    const confirmation = String(data.get('confirmPassword') || '');
    const errors = {};
    let doctor = null;
    let username = '';

    if (role === 'doctor') {
      const doctorId = editing ? existing.doctorId : String(data.get('doctorId') || '');
      doctor = clinicDoctor(doctorId);
      if (!doctor) errors.doctorId = 'Select a doctor.';
      else if (!editing && clinicUsers.some((user) => user.doctorId === doctorId)) errors.doctorId = 'This doctor already has a login. Refresh the list and try again.';
      const stem = String(data.get('usernameStem') || '').trim();
      username = doctorUsername(stem);
      const usernameError = validateLoginUsername(stem, modalState.userId) || validateLoginUsername(username, modalState.userId);
      if (usernameError) errors.usernameStem = usernameError;
      modalState.selectedDoctorId = doctorId;
      modalState.usernameStem = stem;
    } else {
      username = String(data.get('adminUsername') || '').trim();
      const usernameError = validateLoginUsername(username, modalState.userId);
      if (usernameError) errors.adminUsername = usernameError;
      modalState.adminUsername = username;
    }

    const passwordRequired = !editing || Boolean(password || confirmation);
    if (passwordRequired) {
      if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) errors.password = 'Use at least 8 characters with at least one letter and one number.';
      if (!confirmation) errors.confirmPassword = 'Confirm the password.';
      else if (password !== confirmation) errors.confirmPassword = 'Passwords do not match.';
    }

    if (Object.keys(errors).length) return showUserFormErrors(errors);

    let savedUser = existing;
    if (editing) {
      savedUser.username = username;
      savedUser.updated = '26 Sep 2026';
    } else {
      const name = role === 'doctor' ? doctor.name : username.split(/[._-]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') || 'Clinic administrator';
      savedUser = {
        id: `user-preview-${Date.now()}`,
        name,
        username,
        role,
        status: 'active',
        isCurrent: false,
        updated: '26 Sep 2026',
        ...(role === 'doctor' ? { doctorId: doctor.id } : {}),
      };
      clinicUsers.push(savedUser);
    }

    if (passwordRequired) {
      modalState.userId = savedUser.id;
      modalState.step = 'credentials';
      modalState.credentials = { name: savedUser.name, username: savedUser.username, password, isReset: editing };
      return refreshModal(state.modalType, '[data-user-credentials-done]');
    }
    const focusUserId = savedUser.id;
    closeModal({ restoreFocus: false });
    renderApp();
    focusUserManagementTarget(focusUserId);
    showToast('Credentials updated', 'The username was updated. The existing password remains unchanged.');
  }

  function deleteUserLogin() {
    const user = clinicUser(state.userModal?.userId);
    if (!user || !canDeleteClinicUser(user)) return;
    const index = clinicUsers.findIndex((candidate) => candidate.id === user.id);
    if (index >= 0) clinicUsers.splice(index, 1);
    closeModal({ restoreFocus: false });
    renderApp();
    focusUserManagementTarget();
    showToast('Login deleted', `${user.name} can no longer sign in. Linked clinic and clinical records were preserved.`);
  }

  async function copyUserCredentials(part) {
    const credentials = state.userModal?.credentials;
    if (!credentials) return;
    const value = part === 'username' ? credentials.username : part === 'password' ? credentials.password : `Username: ${credentials.username}\nPassword: ${credentials.password}`;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const fallback = document.createElement('textarea');
      fallback.value = value;
      fallback.setAttribute('readonly', '');
      fallback.style.position = 'fixed';
      fallback.style.opacity = '0';
      document.body.append(fallback);
      fallback.select();
      document.execCommand('copy');
      fallback.remove();
    }
    showToast(part === 'both' ? 'Credentials copied' : part === 'username' ? 'Username copied' : 'Password copied', 'Copied to your device clipboard. Share it only through an approved private channel, then clear the clipboard.');
  }

  function handleAppClick(event) {
    const route = event.target.closest('[data-route]');
    if (route) return navigate(route.dataset.route);
    if (event.target.closest('[data-open-mobile-nav]')) return openMobileNav();

    const createUser = event.target.closest('[data-user-create]');
    if (createUser) return openUserFlow('create', '', createUser);

    const editUser = event.target.closest('[data-user-edit]');
    if (editUser) return openUserFlow('edit', editUser.dataset.userEdit, editUser);

    const deleteUser = event.target.closest('[data-user-delete]');
    if (deleteUser) return openUserFlow('delete', deleteUser.dataset.userDelete, deleteUser);

    const userFilter = event.target.closest('[data-user-filter]');
    if (userFilter) {
      state.userFilter = userFilter.dataset.userFilter;
      $$('[data-user-filter]', appContent).forEach((buttonNode) => {
        const active = buttonNode === userFilter;
        buttonNode.classList.toggle('is-active', active);
        buttonNode.setAttribute('aria-pressed', String(active));
      });
      return applyUserAccountFilters();
    }

    const modal = event.target.closest('[data-open-modal]');
    if (modal) return openModal(modal.dataset.openModal, modal);

    const toast = event.target.closest('[data-toast]');
    if (toast) return showToast(toast.dataset.toast);

    const simulate = event.target.closest('[data-simulate]');
    if (simulate) return showToast('Appointment confirmed', 'The item would move to Confirmed & upcoming after a live API response.');

    const call = event.target.closest('[data-call-id]');
    if (call) { state.selectedCall = call.dataset.callId; return renderApp(); }

    const queueItem = event.target.closest('[data-queue-id]');
    if (queueItem) { state.selectedQueue = queueItem.dataset.queueId; return renderApp(); }

    const setup = event.target.closest('[data-setup-section]');
    if (setup) { state.setupSection = setup.dataset.setupSection; return renderApp(); }

    const settings = event.target.closest('[data-settings-section]');
    if (settings) { state.settingsSection = settings.dataset.settingsSection; return renderApp(); }

    const knowledge = event.target.closest('[data-knowledge-section]');
    if (knowledge) { state.knowledgeSection = knowledge.dataset.knowledgeSection; return renderApp(); }

    const appointment = event.target.closest('[data-appointment-section]');
    if (appointment) { state.appointmentSection = appointment.dataset.appointmentSection; return renderApp(); }

    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      const isOn = toggle.classList.toggle('is-on');
      toggle.setAttribute('aria-checked', String(isOn));
      return showToast(isOn ? 'Setting enabled' : 'Setting disabled');
    }
  }

  function handleAppInput(event) {
    if (!event.target.matches('[data-user-search]')) return;
    state.userSearch = event.target.value;
    applyUserAccountFilters();
  }

  function handleModalClick(event) {
    if (event.target.matches('[data-modal-backdrop]')) return closeModal();
    if (event.target.closest('[data-close-modal]')) return closeModal();

    const roleChoice = event.target.closest('[data-user-role-choice]');
    if (roleChoice && state.userModal?.mode === 'create') {
      state.userModal.role = roleChoice.dataset.userRoleChoice;
      state.userModal.selectedDoctorId = '';
      state.userModal.usernameStem = '';
      state.userModal.adminUsername = '';
      return refreshModal('user-create', `[data-user-role-choice="${state.userModal.role}"]`);
    }

    const passwordToggle = event.target.closest('[data-password-toggle]');
    if (passwordToggle) {
      const input = $(`[name="${passwordToggle.dataset.passwordToggle}"]`, modalRoot);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      passwordToggle.innerHTML = icon(input.type === 'password' ? 'eye' : 'eye-off');
      passwordToggle.setAttribute('aria-label', `${input.type === 'password' ? 'Show' : 'Hide'} ${input.name === 'password' ? 'password' : 'password confirmation'}`);
      return;
    }

    if (event.target.closest('[data-user-delete-confirm]')) return deleteUserLogin();
    if (event.target.closest('[data-user-credentials-done]')) {
      const wasReset = state.userModal?.credentials?.isReset;
      const focusUserId = state.userModal?.userId || '';
      closeModal({ restoreFocus: false });
      renderApp();
      focusUserManagementTarget(focusUserId);
      return showToast(wasReset ? 'Password updated' : 'Login added', wasReset ? 'The new password was handed off once and is no longer visible.' : 'The new login now appears in User management.');
    }

    const copyCredentials = event.target.closest('[data-user-copy]');
    if (copyCredentials) return copyUserCredentials(copyCredentials.dataset.userCopy);

    const success = event.target.closest('[data-modal-success]');
    if (success) {
      const message = success.dataset.modalSuccess;
      closeModal();
      return showToast(message);
    }

    if (event.target.closest('[data-booking-next]')) {
      state.modalStep = Math.min(3, state.modalStep + 1);
      return refreshModal();
    }
    if (event.target.closest('[data-booking-back]')) {
      state.modalStep = Math.max(1, state.modalStep - 1);
      return refreshModal();
    }
    const nestedModal = event.target.closest('[data-open-modal]');
    if (nestedModal) return openModal(nestedModal.dataset.openModal, state.modalTrigger);

    const slot = event.target.closest('.slot:not(:disabled)');
    if (slot) {
      $$('.slot', slot.parentElement).forEach((node) => node.classList.remove('is-selected'));
      slot.classList.add('is-selected');
    }
  }

  function handleModalInput(event) {
    if (!state.userModal) return;
    if (event.target.matches('[data-username-stem]')) updateDoctorUsernamePreview();
    if (event.target.matches('[data-admin-username]')) state.userModal.adminUsername = event.target.value;
    if (event.target.matches('[name="password"], [name="confirmPassword"]')) updatePasswordReadiness();

    const error = $(`[data-user-error="${event.target.name}"]`, modalRoot);
    if (error) {
      error.hidden = true;
      error.textContent = '';
      event.target.removeAttribute('aria-invalid');
    }
  }

  function handleModalChange(event) {
    if (event.target.matches('[data-user-doctor]')) {
      state.userModal.selectedDoctorId = event.target.value;
      const doctor = clinicDoctor(event.target.value);
      state.userModal.usernameStem = doctor ? usernameStemForDoctor(doctor.name) : '';
      return refreshModal(state.modalType, doctor ? '[data-username-stem]' : '[data-user-doctor]');
    }
    if (event.target.matches('[data-delete-acknowledgement]')) {
      const confirmButton = $('[data-user-delete-confirm]', modalRoot);
      if (confirmButton) confirmButton.disabled = !event.target.checked;
    }
  }

  function openMobileNav() {
    document.body.classList.add('nav-open');
    $('#mobileScrim').hidden = false;
    $('#closeMobileNav').focus();
  }

  function closeMobileNav() {
    document.body.classList.remove('nav-open');
    $('#mobileScrim').hidden = true;
    $('#openMobileNav').focus();
  }

  function bindPublicExperience() {
    $('#dismissBanner').addEventListener('click', () => document.body.classList.add('banner-dismissed'));

    $$('[data-enter-portal]').forEach((node) => node.addEventListener('click', () => enterPortal(node.dataset.enterPortal)));
    $$('[data-return-login]').forEach((node) => node.addEventListener('click', returnToLogin));

    $$('[data-auth-tab]').forEach((buttonNode) => {
      buttonNode.addEventListener('click', () => {
        const tab = buttonNode.dataset.authTab;
        $$('[data-auth-tab]').forEach((item) => {
          const active = item === buttonNode;
          item.classList.toggle('is-active', active);
          item.setAttribute('aria-selected', String(active));
        });
        $('#signInForm').classList.toggle('is-hidden', tab !== 'signin');
        $('#registerForm').classList.toggle('is-hidden', tab !== 'register');
        $('#authCardTitle').textContent = tab === 'signin' ? 'Sign in to your clinic' : 'Create your clinic workspace';
        $('#authCardDescription').textContent = tab === 'signin' ? 'Use your assigned account to continue securely.' : 'Start with clinic details, then verify the administrator account.';
      });
    });

    $$('input[name="preview-role"]').forEach((input) => {
      input.addEventListener('change', () => {
        $$('.role-card').forEach((card) => card.classList.toggle('is-selected', $('input', card).checked));
      });
    });

    $('#signInForm').addEventListener('submit', (event) => {
      event.preventDefault();
      enterPortal($('input[name="preview-role"]:checked').value);
    });

    $('#togglePassword').addEventListener('click', () => {
      const input = $('#passwordInput');
      input.type = input.type === 'password' ? 'text' : 'password';
      $('#togglePassword').setAttribute('aria-label', input.type === 'password' ? 'Show password' : 'Hide password');
    });

    $('[data-registration-next]').addEventListener('click', () => showToast('Registration flow preview', 'The next production steps collect administrator details and verify a six-digit email code.'));

    $$('[data-open-modal]', authExperience).forEach((node) => node.addEventListener('click', () => openModal(node.dataset.openModal, node)));

    $$('[data-workflow-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        $$('[data-workflow-tab]').forEach((item) => {
          const active = item === tab;
          item.classList.toggle('is-active', active);
          item.setAttribute('aria-selected', String(active));
        });
        $('[data-workflow-canvas]').dataset.activeRole = tab.dataset.workflowTab;
      });
    });

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    $$('.reveal-section').forEach((section) => observer.observe(section));
  }

  function bindPortal() {
    portalExperience.addEventListener('click', handleAppClick);
    portalExperience.addEventListener('input', handleAppInput);
    modalRoot.addEventListener('click', handleModalClick);
    modalRoot.addEventListener('input', handleModalInput);
    modalRoot.addEventListener('change', handleModalChange);
    modalRoot.addEventListener('submit', (event) => {
      if (!event.target.matches('#userLoginForm')) return;
      event.preventDefault();
      saveUserLogin();
    });
    $('#openMobileNav').addEventListener('click', openMobileNav);
    $('#closeMobileNav').addEventListener('click', closeMobileNav);
    $('#mobileScrim').addEventListener('click', closeMobileNav);

    personaSelect.addEventListener('change', () => {
      state.persona = personaSelect.value;
      state.route = state.persona === 'doctor' ? 'today' : state.persona === 'platform' || state.persona === 'support' ? 'platform-clinics' : 'home';
      state.setupSection = state.persona === 'doctor' ? 'schedules' : 'doctors';
      state.settingsSection = state.persona === 'doctor' ? 'languages' : 'agent';
      updateHash();
      renderApp({ focus: true });
      showToast(`Preview switched to ${personaSelect.options[personaSelect.selectedIndex].text}`);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (modalRoot.innerHTML) return closeModal();
        if (document.body.classList.contains('nav-open')) return closeMobileNav();
      }
      if (event.key === 'Tab' && modalRoot.innerHTML) {
        const focusable = $$('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]', modalRoot).filter((node) => node.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
  }

  bindPublicExperience();
  bindPortal();
  const queryPreviewActive = syncPreviewFromQuery();
  if (!queryPreviewActive) syncFromHash();
  window.setTimeout(() => {
    $$('.reveal-section').forEach((section) => section.classList.add('is-visible'));
  }, 450);
  if (!queryPreviewActive && !location.hash.startsWith('#app/')) {
    requestAnimationFrame(() => $$('.reveal-section').forEach((section, index) => {
      if (index === 0) section.classList.add('is-visible');
    }));
  }
})();
