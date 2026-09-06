/**
 * English strings — the SOURCE OF TRUTH for keys and the fallback language.
 * All UI text goes through i18next keys (brief §9): no hardcoded strings.
 *
 * POSITIONING (§1): copy here must never imply diagnosis / TB detection / risk
 * score. Use "pre-screening", "supports", "flags for referral", "presumptive".
 */
export const en = {
  common: {
    appName: 'TB-Screen BHW',
    back: 'Back',
    cancel: 'Cancel',
    continue: 'Continue',
    yes: 'Yes',
    no: 'No',
    unsure: 'Unsure',
    outcomePositive: 'Positive',
    outcomeNegative: 'Negative',
  },
  home: {
    title: 'TB-Screen BHW',
    signInBanner: 'Sign in to sync and enroll patients. Already-saved work stays on this device.',
    sessionExpiredBanner:
      'Your session ended — sign in again to keep syncing. Your patients and saved work are still on this phone.',
    signInCta: 'Sign in',
    syncChipSynced: 'Synced',
    syncChipSyncing: 'Syncing…',
    syncChipOffline: 'Offline',
    syncChipNever: 'Tap to sync',
    lastSync: 'Last synced {{date}}',
    neverSynced: 'Not synced yet — tap the button above when online.',
    syncOffline:
      "Can't sync right now — no internet connection. Your records are saved on this phone and will sync automatically once you're back online.",
    syncError: "Couldn't sync — please try again. If it keeps happening, tell your coordinator: {{message}}",
    syncPartial:
      '{{count}} record(s) could not be uploaded. Everything else synced. They are still saved on this phone and will be tried again — if this keeps happening, tell your coordinator.',
    syncPartial_one:
      '1 record could not be uploaded. Everything else synced. It is still saved on this phone and will be tried again — if this keeps happening, tell your coordinator.',
    syncPartial_other:
      '{{count}} records could not be uploaded. Everything else synced. They are still saved on this phone and will be tried again — if this keeps happening, tell your coordinator.',
    primaryCta: 'Enroll & screen a patient',
    attentionHeading: 'Needs attention',
    tiles: {
      upcoming: 'Upcoming',
      missed: 'Missed',
      noShow: 'No-shows',
    },
    allCaughtUp: 'All caught up — nothing needs follow-up right now.',
    resultsSection: 'New results',
    emptySection: 'Nothing here right now.',
  },
  followUps: {
    title: 'Follow-ups',
    empty: 'No patients here right now',
    emptySub: 'Patients flagged by the TB-DOTS facility will appear in this list.',
  },
  tabs: {
    home: 'Home',
    patients: 'Patients',
    settings: 'Settings',
  },
  signIn: {
    title: 'Sign in',
    intro: 'BHW accounts are provided by your program coordinator. Signing in needs a connection; afterwards the app works offline.',
    email: 'Email',
    password: 'Password',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    helper: 'Access is provisioned by your administrator. Contact them if you can’t sign in.',
    cta: 'Sign in',
    error: 'Sign-in failed: {{message}}',
    errorOffline:
      'You need an internet connection to sign in. Once you are signed in, the app works offline.',
    refusedInactive:
      'This account has been deactivated. Ask your barangay captain or program coordinator to reactivate it.',
    refusedWrongRole:
      'This app is for Barangay Health Workers. Your account is {{destination}} — please sign in on the TB-Screen portal on a computer.',
    refusedNoAccount:
      'This account is not set up for the app yet. Please contact your program coordinator.',
  },
  /**
   * Blocked account (D-07). Shown over the whole app when the server says this
   * account may no longer use it.
   */
  blocked: {
    inactiveTitle: 'This account has been deactivated',
    inactiveBody:
      'You can no longer use the app with this account. Ask your barangay captain or program coordinator to reactivate it.',
    wrongRoleTitle: 'This app is for Barangay Health Workers',
    wrongRoleBody:
      'Your account is {{destination}}. Please sign in on the TB-Screen portal on a computer instead.',
    noAccountTitle: 'This account is not set up',
    noAccountBody:
      'We could not find the details for this account. Please contact your program coordinator.',
    roleFacility: 'a health facility account',
    roleCaptain: 'a barangay captain account',
    roleAdmin: 'an administrator account',
    roleOther: 'not a Barangay Health Worker account',
    pendingNote:
      'Signing out uploads anything still waiting first. If some records cannot be uploaded, you will be asked before anything is removed from this phone.',
    signOut: 'Sign out',
  },
  /**
   * Forced password change (D-06). Shown over the whole app while the account
   * still holds the password its captain or admin provisioned.
   */
  password: {
    gateTitle: 'Set your own password',
    gateSub:
      'This account is still using the password your coordinator gave you. Choose a password only you know before you continue.',
    signedInAs: 'Signed in as {{email}}',
    newLabel: 'New password',
    confirmLabel: 'Confirm new password',
    hint: 'At least {{min}} characters. Do not reuse the password you were given.',
    cta: 'Save password and continue',
    saving: 'Saving…',
    signOut: 'Sign out instead',
    errTooShort: 'Use at least {{min}} characters.',
    errLooksProvisioned: 'That is a password the system generated. Choose one of your own.',
    errMismatch: 'The two passwords do not match.',
    errApi: 'Could not save the password: {{message}}',
    errFlag:
      'Your password was changed, but this phone could not finish. Sign in again using your new password.',
  },
  status: {
    submitted: 'Submitted',
    received: 'Received',
    tested: 'Tested',
    closed: 'Closed',
  },
  welcome: {
    disclaimerHeading: 'This app does not diagnose TB',
    disclaimerBody:
      'This app supports pre-screening and referral for tuberculosis (TB). It does NOT diagnose TB and cannot tell whether a person has TB. Only TB-DOTS facilities can diagnose TB through laboratory testing. This app only helps flag people who may need to be referred for testing (presumptive TB).',
    termsHeading: 'Terms and data privacy',
    termsBody:
      'Personal information is collected only to support referral and follow-up. A patient’s contact number is stored only if the patient agrees to receive SMS reminders. Information is shared only with the receiving TB-DOTS facility. By continuing, you agree to use this tool responsibly and to explain its purpose to each patient in their own language.',
    acceptCta: 'I understand and agree',
    tagline: 'Pre-screening support tool for Barangay Health Workers',
    languageHint: 'You can change this anytime in Settings',
  },
  terms: {
    title: 'Terms and disclaimer',
    acceptedOn: 'You accepted these terms on {{date}}.',
    notAccepted: 'Not yet accepted.',
  },
  settings: {
    title: 'Settings',
    accountSection: 'Account',
    signIn: 'Sign in',
    signOut: 'Sign out',
    signOutConfirmTitle: 'Sign out?',
    signOutConfirmBody:
      'Offline records on this phone will be cleared so the next account cannot see them. Anything not yet synced is uploaded first — if something cannot be uploaded, you will be asked before it is cleared.',
    signOutSyncing: 'Syncing…',
    signOutPendingTitle: 'Not everything is uploaded',
    signOutPendingBody:
      '{{count}} record(s) on this phone have not reached the server yet. Signing out deletes them permanently. If you can, connect to the internet and sync before signing out.',
    signOutPendingBody_one:
      '1 record on this phone has not reached the server yet. Signing out deletes it permanently. If you can, connect to the internet and sync before signing out.',
    signOutPendingBody_other:
      '{{count}} records on this phone have not reached the server yet. Signing out deletes them permanently. If you can, connect to the internet and sync before signing out.',
    staySignedIn: 'Stay signed in',
    signOutDiscard: 'Sign out and delete',
    languageSection: 'Language',
    legalSection: 'Legal',
    viewTerms: 'View terms and disclaimer',
    developerSection: 'Developer',
    resetFirstLaunch: 'Reset first-launch (show welcome again)',
    assignedSection: 'My assigned barangay',
    assignedHint:
      'Used to pre-fill the address when enrolling a patient. You can still change the address for each patient.',
    assignedPendingPush: 'Saved on this device — your profile will update when online.',
  },
  address: {
    region: 'Region',
    province: 'Province',
    city: 'City / Municipality',
    barangay: 'Barangay',
    sitio: 'Sitio / Purok (optional)',
    search: 'Search…',
  },
  consent: {
    heading: 'Patient consent',
    intro:
      'Explain the purpose of this pre-screening to the patient in their own language before continuing.',
    confirmLabel: 'The patient consents to pre-screening and referral.',
    smsOptInLabel: 'Send SMS check-up reminders to this patient',
    smsHint: 'Only if the patient agrees. A mobile number is required to send SMS.',
    contactNumberLabel: 'Mobile number',
    smsLanguageLabel: 'Language for reminder texts',
    contactNumberPlaceholder: '09XXXXXXXXX',
    contactNumberError: 'Enter a valid mobile number, or turn off SMS reminders.',
    nonDiagnosticReminder: 'Reminder: this tool supports referral only. It does not diagnose TB.',
  },
  sex: {
    male: 'Male',
    female: 'Female',
  },
  patients: {
    title: 'Patients',
    empty: 'No patients on this device yet. Enroll a patient to start.',
    noMatch: 'No patient matches that code.',
    searchPlaceholder: 'Search patients…',
    enrollCta: 'Enroll patient',
    itemDescription: '{{sex}}, {{age}} yrs',
  },
  enroll: {
    title: 'Enroll patient',
    intro:
      'A patient code (e.g. PAT-XXXX-0001) is assigned automatically on save. Patient details are shared only with the receiving TB-DOTS facility.',
    requiredHint: 'Fields marked * are required.',
    fullNameLabel: 'Full name',
    firstNameLabel: 'First name',
    middleNameLabel: 'Middle name',
    lastNameLabel: 'Last name',
    birthdateLabel: 'Birthdate',
    ageLabel: 'Age',
    sexLabel: 'Sex',
    addressSection: 'Address',
    addressHint:
      'Pre-filled from your assigned barangay. Change it if this patient lives elsewhere.',
    signInRequired:
      'Sign in before enrolling — each record must carry the enrolling BHW’s account. (Sign-in is on the developer sync-test screen for now.)',
    goToSignIn: 'Go to sign-in',
    saveCta: 'Enroll patient',
    missingFields: 'Complete the required fields: consent, name, birthdate, sex, and barangay.',
  },
  patientDetail: {
    ageSex: 'Age and sex',
    smsLabel: 'SMS reminders',
    smsOptedIn: 'Yes — {{number}}',
    smsDeclined: 'No',
    syncPending: 'Waiting to sync',
    syncSynced: 'Synced',
    screeningsSection: 'Screenings',
    noScreenings: 'No screenings recorded yet.',
    startScreening: 'Start screening',
    flaggedChip: 'Flagged for referral',
    notFlaggedChip: 'Not flagged',
    pgisShort: 'Cough severity (PGI-S): {{value}}',
    notFound: 'Patient not found on this device.',
    createReferral: 'Create referral',
    viewReferralDoc: 'Referral document',
    noShowChip: 'No-show',
    // D-05: the facility's free-text notes are deliberately NOT shown here (or
    // pulled to the device). A BHW sees the outcome the facility recorded, plus
    // what to do about it — displayed, never computed (§1).
    resultRecorded: 'Result recorded {{date}}',
    resultPositive:
      'The facility recorded a POSITIVE result. Make sure this patient goes back to the TB-DOTS facility to start treatment.',
    resultNegative:
      'The facility recorded a NEGATIVE result. The facility will advise on any next steps.',
    resultAskFacility: 'For any details, ask the TB-DOTS facility.',
    appt: {
      scheduled: 'Upcoming',
      attended: 'Attended',
      missed: 'Missed',
    },
    editDetails: 'Edit details',
    saveChanges: 'Save changes',
    enrolledBy: 'Enrolled by {{name}} (BHW)',
  },
  referral: {
    title: 'Create referral',
    screeningSummary: 'Screening on {{date}}',
    facilitySection: 'Receiving TB-DOTS facility',
    noFacilities:
      'No TB-DOTS facilities on this device yet. Sync once while online to download the facility list.',
    appointmentSection: 'Check-up appointment',
    appointmentHint: 'The date the patient is asked to visit the TB-DOTS facility.',
    pickDate: 'Appointment date',
    createCta: 'Create referral',
    missing: 'Pick a facility and an appointment date.',
    alreadyExists: 'This screening already has a referral.',
    notFlagged: 'Only screenings flagged by the checklist can create a referral.',
  },
  referralDoc: {
    title: 'Referral document',
    heading: 'TB pre-screening referral',
    subheading: 'Pre-screening referral — NOT a diagnosis. Only TB-DOTS facilities diagnose TB.',
    optionalNote:
      'This referral has already been sent to the TB-DOTS facility. Printing is optional — give the patient a copy only if it helps them.',
    patientSection: 'Patient',
    patientCode: 'Patient code',
    screeningSection: 'Screening (DOH-NTP checklist)',
    screeningDate: 'Screening date',
    pgisLine: 'Patient-rated cough severity (PGI-S, supplementary): {{value}}',
    pgisNotRecorded: 'Patient-rated cough severity (PGI-S, supplementary): not recorded',
    vitalsSection: 'Vital signs (as measured)',
    vitalsNote:
      'Measurements only, recorded for the facility. They do not affect the referral recommendation.',
    referralSection: 'Referral',
    facility: 'Receiving facility',
    appointment: 'Check-up appointment',
    sputumNote: 'Sputum collection and testing are done at the TB-DOTS facility.',
    preparedBy: 'Prepared by (BHW signature)',
    generatedAt: 'Generated {{date}}',
    qrCaption: 'Scan at the TB-DOTS facility to load this referral.',
    printCta: 'Print',
    shareCta: 'Share',
    printError: 'Could not print: {{message}}',
    notFound: 'Referral not found on this device.',
  },
  vitals: {
    heading: 'Vital signs',
    intro:
      'Record whatever you were able to measure. Any field may be left blank, and skipping this step does not affect the referral.',
    optionalTag: 'Optional',
    height: 'Height',
    weight: 'Weight',
    temperature: 'Temperature',
    systolic: 'Systolic BP',
    diastolic: 'Diastolic BP',
    pulse: 'Pulse rate',
    spo2: 'Oxygen saturation',
    bmi: 'BMI',
    bmiDerived: 'BMI, from height and weight',
    bloodPressure: 'Blood pressure',
    unitCm: 'cm',
    unitKg: 'kg',
    unitC: '°C',
    unitMmHg: 'mmHg',
    unitBpm: 'bpm',
    unitPercent: '%',
    unitBmi: 'kg/m²',
    outOfRange: 'Check the reading marked in red — that value looks like a typing slip.',
    fixBeforeContinuing: 'Fix the reading marked in red',
    skipCta: 'Skip — nothing measured',
  },
  screening: {
    checklistHeading: 'DOH-NTP symptom checklist',
    symptoms: {
      cough_2wks: 'Cough for 2 weeks or more',
      weight_loss: 'Unexplained weight loss',
      night_sweats: 'Night sweats',
      fever: 'Unexplained fever',
      hemoptysis: 'Coughing up blood (hemoptysis)',
      chest_pain: 'Chest pain',
      fatigue: 'Fatigue / tiredness',
      loss_of_appetite: 'Loss of appetite',
      tb_contact: 'Close contact with a person known to have TB',
    },
    pgisHeading: 'Patient-rated cough severity (PGI-S)',
    pgisIntro:
      'Ask the patient to answer in their own words — this is the patient’s own rating, not yours. Supplementary information only — it never affects the referral recommendation.',
    pgisOptions: {
      none: 'None',
      mild: 'Mild',
      moderate: 'Moderate',
      severe: 'Severe',
    },
    outcomeTitleReferred: 'Refer this patient',
    outcomeTitleNot: 'No referral flagged',
    outcomeReferred: 'The checklist flags this patient for referral (presumptive TB).',
    reasonCardinal:
      'Reason: at least one cardinal symptom (cough ≥ 2 weeks, fever, night sweats, weight loss, or coughing up blood) was answered “yes”.',
    reasonContact:
      'Reason: close contact with a known TB case, plus at least one reported symptom.',
    outcomeNotReferred: 'The checklist does not flag this patient for referral.',
    notReferredAdvice: 'Advise the patient to return if symptoms appear or worsen.',
    nonDiagnostic: 'This is not a diagnosis. Only a TB-DOTS facility can diagnose TB.',
    saveCta: 'Save screening',
    answerAll: 'Answer every checklist item to save.',
    next: 'Next',
    answerFirst: 'Choose an answer',
    stepOf: '{{step}} / {{total}}',
    reviewTitle: 'Review answers',
    reviewHint: 'Tap an answer to change it before finishing.',
    seeRecommendation: 'See recommendation',
    patientReportedTag: 'Patient-reported',
  },
};

// Shape of a full translation set. Values are `string` (not literals), so tl/ceb
// must supply every key but may use any text. Missing keys are a compile error.
export type Translation = typeof en;
