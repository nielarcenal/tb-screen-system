/**
 * TODO i18n verify — Cebuano. Best-effort translations that MUST be reviewed by
 * a native speaker before release (brief §9). Cebuano medical/consent phrasing is
 * especially uncertain here — flag for review. Keep the non-diagnostic
 * positioning (§1): never imply the app detects/diagnoses TB.
 */
import type { Translation } from './en';

export const ceb: Translation = {
  common: {
    appName: 'TB-Screen BHW',
    back: 'Balik',
    cancel: 'Kanselahon',
    continue: 'Padayon',
    yes: 'Oo',
    no: 'Dili',
    unsure: 'Dili sigurado',
    outcomePositive: 'Positibo',
    outcomeNegative: 'Negatibo',
  },
  home: {
    title: 'TB-Screen BHW',
    signInBanner:
      'Pag-sign in aron maka-sync ug maka-enroll og pasyente. Magpabilin niining device ang mga natala na.',
    sessionExpiredBanner:
      'Natapos ang imong session — pag-sign in pag-usab aron makapadayon sa pag-sync. Anaa pa gihapon niining telepono ang imong mga pasyente ug natala nga trabaho.',
    signInCta: 'Pag-sign in',
    syncChipSynced: 'Naka-sync',
    syncChipSyncing: 'Nagsi-sync…',
    syncChipOffline: 'Offline',
    syncChipNever: 'Pinduta aron mag-sync',
    lastSync: 'Kataposang na-sync {{date}}',
    neverSynced: 'Wala pa naka-sync — pinduta ang button sa taas kung online na.',
    syncOffline:
      'Dili maka-sync karon — walay internet. Naka-save niining telepono ang imong mga tala ug awtomatikong mag-sync kung online na ka.',
    syncError:
      'Dili maka-sync — palihug sulayi pag-usab. Kung magpadayon, sultihi ang imong coordinator: {{message}}',
    // Intl.PluralRules returns "one" for EVERY count in ceb, so _one must carry
    // {{count}} — a hardcoded "1" here would be shown for any number.
    syncPartial:
      'Naay {{count}} ka rekord nga wala ma-upload. Na-sync ra ang uban. Naa pa gihapon kini niining telepono ug sulayan pag-usab — kung magbalik-balik kini, sultihi ang imong coordinator.',
    syncPartial_one:
      'Naay {{count}} ka rekord nga wala ma-upload. Na-sync ra ang uban. Naa pa gihapon kini niining telepono ug sulayan pag-usab — kung magbalik-balik kini, sultihi ang imong coordinator.',
    syncPartial_other:
      'Naay {{count}} ka rekord nga wala ma-upload. Na-sync ra ang uban. Naa pa gihapon kini niining telepono ug sulayan pag-usab — kung magbalik-balik kini, sultihi ang imong coordinator.',
    primaryCta: 'Pag-enroll ug pag-screen og pasyente',
    attentionHeading: 'Nagkinahanglan og atensyon',
    tiles: {
      upcoming: 'Umaabot',
      missed: 'Wala mitambong',
      noShow: 'No-show',
    },
    allCaughtUp: 'Human na tanan — walay kinahanglan i-follow up karon.',
    resultsSection: 'Mga bag-ong resulta',
    emptySection: 'Wala pay sulod dinhi karon.',
  },
  // TODO i18n verify
  followUps: {
    title: 'Mga follow-up',
    empty: 'Walay pasyente dinhi karon',
    emptySub: 'Mogawas dinhi ang mga pasyenteng gi-flag sa TB-DOTS facility.',
  },
  tabs: {
    home: 'Home',
    patients: 'Mga Pasyente',
    settings: 'Mga Setting',
  },
  signIn: {
    title: 'Pag-sign in',
    intro:
      'Ang mga BHW account ihatag sa inyong program coordinator. Kinahanglan og koneksyon ang pag-sign in; human niana mogana ang app offline.',
    email: 'Email',
    password: 'Password',
    showPassword: 'Ipakita ang password',
    hidePassword: 'Tagoi ang password',
    helper: 'Ang access gihatag sa inyong administrator. Kontaka sila kung dili kamo maka-sign in.',
    cta: 'Pag-sign in',
    error: 'Napakyas ang pag-sign in: {{message}}',
    // TODO i18n verify
    errorOffline:
      'Kinahanglan og koneksyon sa internet aron maka-sign in. Human ka maka-sign in, mogana ang app bisan offline.',
    // TODO i18n verify
    refusedInactive:
      'Kini nga account gi-deactivate na. Hangyoa ang imong barangay midwife o program coordinator nga i-activate kini pag-usab.',
    refusedWrongRole:
      'Kini nga app para sa mga Barangay Health Worker. Ang imong account usa ka {{destination}} — palihug pag-sign in sa TB-Screen portal sa computer.',
    refusedNoAccount:
      'Kini nga account wala pa ma-andam para sa app. Palihug kontaka ang imong program coordinator.',
  },
  /**
   * Blocked account (D-07). Shown over the whole app when the server says this
   * account may no longer use it.
   */
  // TODO i18n verify
  blocked: {
    inactiveTitle: 'Kini nga account gi-deactivate na',
    inactiveBody:
      'Dili na nimo magamit ang app gamit kini nga account. Hangyoa ang imong barangay midwife o program coordinator nga i-activate kini pag-usab.',
    wrongRoleTitle: 'Kini nga app para sa mga Barangay Health Worker',
    wrongRoleBody:
      'Ang imong account usa ka {{destination}}. Palihug pag-sign in sa TB-Screen portal sa computer.',
    noAccountTitle: 'Wala ma-andam kini nga account',
    noAccountBody:
      'Wala namo makita ang mga detalye niini nga account. Palihug kontaka ang imong program coordinator.',
    roleFacility: 'account sa health facility',
    roleMidwife: 'account sa barangay midwife',
    roleAdmin: 'account sa administrator',
    roleOther: 'dili account sa Barangay Health Worker',
    pendingNote:
      'Kung mag-sign out, i-upload una ang mga naghulat pa. Kung adunay mga record nga dili ma-upload, pangutan-on ka una una pa may mapapas niini nga telepono.',
    signOut: 'Mag-sign out',
  },
  /**
   * Forced password change (D-06). Shown over the whole app while the account
   * still holds the password its midwife or admin provisioned.
   */
  password: {
    gateTitle: 'Paghimo og kaugalingong password',
    gateSub:
      'Kini nga account naggamit pa sa password nga gihatag sa imong coordinator. Pagpili og password nga ikaw ra ang nakahibalo una ka magpadayon.',
    signedInAs: 'Naka-sign in isip {{email}}',
    newLabel: 'Bag-ong password',
    confirmLabel: 'Kumpirmaha ang bag-ong password',
    hint: 'Labing menos {{min}} ka karakter. Ayaw gamita pag-usab ang password nga gihatag kanimo.',
    cta: 'I-save ang password ug padayon',
    saving: 'Nag-save…',
    signOut: 'Mag-sign out na lang',
    errTooShort: 'Gamit og labing menos {{min}} ka karakter.',
    errLooksProvisioned:
      'Kana usa ka password nga gihimo sa sistema. Pagpili og imong kaugalingon.',
    errMismatch: 'Wala magkatugma ang duha ka password.',
    errApi: 'Wala ma-save ang password: {{message}}',
    errFlag:
      'Nausab ang imong password, apan wala nahuman kini nga telepono. Mag-sign in pag-usab gamit ang bag-ong password.',
  },
  status: {
    submitted: 'Gisumite',
    received: 'Nadawat',
    tested: 'Nasusi',
    closed: 'Sirado',
  },
  welcome: {
    disclaimerHeading: 'Kini nga app dili mag-diagnose sa TB',
    disclaimerBody:
      'Kini nga app nagsuporta sa pre-screening ug referral para sa tuberculosis (TB). DILI kini mag-diagnose sa TB ug dili masulti kung ang usa ka tawo adunay TB. Ang mga pasilidad sa TB-DOTS lamang ang makahimo pag-diagnose sa TB pinaagi sa laboratory testing. Kini nga app nagtabang lamang sa pag-ila sa mga tawo nga kinahanglan basin i-refer para sa testing (presumptive TB).',
    termsHeading: 'Mga termino ug privacy sa datos',
    termsBody:
      'Ang personal nga impormasyon gikolekta lamang aron suportahan ang referral ug follow-up. Ang contact number sa pasyente i-tipig lamang kung miuyon ang pasyente nga modawat og SMS reminders. Ang impormasyon i-ambit lamang ngadto sa nagadawat nga pasilidad sa TB-DOTS. Pinaagi sa pagpadayon, miuyon ka nga gamiton kini nga tool nga responsable ug ipasabot ang katuyoan niini sa matag pasyente sa ilang kaugalingong pinulongan.',
    acceptCta: 'Nakasabot ko ug miuyon ko',
    // TODO i18n verify
    tagline: 'Himan sa pauna nga pagsusi alang sa mga Barangay Health Worker',
    languageHint: 'Mahimo kining usbon bisan kanus-a sa Settings',
  },
  terms: {
    title: 'Mga termino ug disclaimer',
    acceptedOn: 'Gidawat nimo kini nga mga termino niadtong {{date}}.',
    notAccepted: 'Wala pa madawat.',
  },
  settings: {
    title: 'Mga Setting',
    accountSection: 'Account',
    signIn: 'Pag-sign in',
    signOut: 'Pag-sign out',
    // TODO i18n verify
    signOutConfirmTitle: 'Pag-sign out?',
    signOutConfirmBody:
      'Papason ang mga offline nga rekord niining telepono aron dili makita sa sunod nga account. Ipadala una ang wala pa ma-sync — kung naay dili mapadala, pangutan-on ka una sa dili pa kini papason.',
    signOutSyncing: 'Nag-sync…',
    signOutPendingTitle: 'Naay wala pa maipadala',
    signOutPendingBody:
      'Naay {{count}} ka rekord nga wala pa makaabot sa server. Kung mo-sign out ka, permanente kining mawala. Kung mahimo, konektar sa internet ug mag-sync una sa dili pa mo-sign out.',
    signOutPendingBody_one:
      'Naay {{count}} ka rekord nga wala pa makaabot sa server. Kung mo-sign out ka, permanente kining mawala. Kung mahimo, konektar sa internet ug mag-sync una sa dili pa mo-sign out.',
    signOutPendingBody_other:
      'Naay {{count}} ka rekord nga wala pa makaabot sa server. Kung mo-sign out ka, permanente kining mawala. Kung mahimo, konektar sa internet ug mag-sync una sa dili pa mo-sign out.',
    staySignedIn: 'Magpabilin nga naka-sign in',
    signOutDiscard: 'Mag-sign out ug papason',
    languageSection: 'Pinulongan',
    legalSection: 'Legal',
    viewTerms: 'Tan-awa ang mga termino ug disclaimer',
    developerSection: 'Developer',
    resetFirstLaunch: 'I-reset ang first-launch (ipakita usab ang welcome)',
    assignedSection: 'Akong gitahasang barangay',
    assignedHint:
      'Gigamit aron daan nga pun-on ang address kung mag-enroll og pasyente. Mahimo gihapon nimong usbon ang address sa matag pasyente.',
    assignedPendingPush:
      'Na-save niini nga device — ma-update ang imong profile kung online na.',
  },
  address: {
    region: 'Rehiyon',
    province: 'Probinsya',
    city: 'Siyudad / Munisipyo',
    barangay: 'Barangay',
    sitio: 'Sitio / Purok (opsyonal)',
    search: 'Pangita…',
  },
  consent: {
    heading: 'Pagtugot sa pasyente',
    intro:
      'Ipasabot ang katuyoan niini nga pre-screening sa pasyente sa ilang kaugalingong pinulongan usa mopadayon.',
    confirmLabel: 'Ang pasyente mitugot sa pre-screening ug referral.',
    smsOptInLabel: 'Pagpadala og SMS reminders para sa check-up niini nga pasyente',
    smsHint: 'Kung miuyon lamang ang pasyente. Kinahanglan og mobile number aron makapadala og SMS.',
    contactNumberLabel: 'Mobile number',
    smsLanguageLabel: 'Pinulongan sa mga SMS reminder',
    contactNumberPlaceholder: '09XXXXXXXXX',
    contactNumberError: 'Pagbutang og husto nga mobile number, o i-off ang SMS reminders.',
    nonDiagnosticReminder: 'Pahinumdom: kini nga tool nagsuporta lamang sa referral. Dili kini mag-diagnose sa TB.',
  },
  sex: {
    male: 'Lalaki',
    female: 'Babaye',
  },
  patients: {
    title: 'Mga Pasyente',
    empty: 'Wala pay pasyente niining device. Pag-enroll og pasyente aron magsugod.',
    noMatch: 'Walay pasyenteng motukma nianang code.',
    searchPlaceholder: 'Pangitaa ang pasyente…',
    enrollCta: 'I-enroll ang pasyente',
    itemDescription: '{{sex}}, {{age}} ka tuig',
  },
  enroll: {
    title: 'I-enroll ang pasyente',
    intro:
      'Awtomatikong hatagan og patient code (pananglitan PAT-XXXX-0001) inig-save. Ang detalye sa pasyente ipaambit lamang sa nagadawat nga TB-DOTS facility.',
    requiredHint: 'Gikinahanglan ang mga field nga adunay markang *.',
    fullNameLabel: 'Tibuok nga ngalan',
    firstNameLabel: 'Ngalan',
    middleNameLabel: 'Tunga nga ngalan',
    lastNameLabel: 'Apelyido',
    birthdateLabel: 'Petsa sa pagkatawo',
    ageLabel: 'Edad',
    sexLabel: 'Sekso',
    addressSection: 'Address',
    addressHint:
      'Daan nang napun-an gikan sa imong gitahasang barangay. Usba kung lahi ang gipuy-an sa pasyente.',
    signInRequired:
      'Pag-sign in una sa dili pa mag-enroll — matag rekord kinahanglan nakatala sa account sa BHW. (Sa pagkakaron, anaa sa developer sync-test screen ang sign-in.)',
    goToSignIn: 'Adto sa sign-in',
    saveCta: 'I-enroll ang pasyente',
    missingFields:
      'Kompletoha ang gikinahanglang mga field: pagtugot, ngalan, petsa sa pagkatawo, sekso, ug barangay.',
  },
  patientDetail: {
    ageSex: 'Edad ug sekso',
    smsLabel: 'SMS reminders',
    smsOptedIn: 'Oo — {{number}}',
    smsDeclined: 'Dili',
    syncPending: 'Nagahulat ma-sync',
    syncSynced: 'Na-sync na',
    screeningsSection: 'Mga screening',
    noScreenings: 'Wala pay natala nga screening.',
    startScreening: 'Sugdi ang screening',
    flaggedChip: 'Gi-flag alang sa referral',
    notFlaggedChip: 'Wala ma-flag',
    pgisShort: 'Kabug-at sa ubo (PGI-S): {{value}}',
    notFound: 'Wala makit-an ang pasyente niining device.',
    createReferral: 'Paghimo og referral',
    viewReferralDoc: 'Dokumento sa referral',
    noShowChip: 'No-show',
    resultRecorded: 'Narekord ang resulta niadtong {{date}}',
    resultPositive:
      'POSITIBO ang narekord nga resulta sa pasilidad. Siguroha nga mobalik ang pasyente sa TB-DOTS nga pasilidad aron magsugod og tambal.',
    resultNegative:
      'NEGATIBO ang narekord nga resulta sa pasilidad. Ang pasilidad maoy mosulti sa sunod nga mga lakang.',
    resultAskFacility: 'Para sa detalye, pangutana sa TB-DOTS nga pasilidad.',
    // TODO i18n verify
    appt: {
      scheduled: 'Umaabot',
      attended: 'Mitambong',
      missed: 'Wala natuman',
    },
    editDetails: 'Usba ang detalye',
    saveChanges: 'I-save ang mga kausaban',
    enrolledBy: 'Gi-enroll ni {{name}} (BHW)',
  },
  referral: {
    title: 'Paghimo og referral',
    screeningSummary: 'Screening niadtong {{date}}',
    facilitySection: 'Nagadawat nga pasilidad sa TB-DOTS',
    noFacilities:
      'Wala pay pasilidad sa TB-DOTS niining device. Pag-sync og kausa samtang online aron ma-download ang listahan sa mga pasilidad.',
    appointmentSection: 'Appointment alang sa check-up',
    appointmentHint: 'Ang petsa nga hangyoon ang pasyente nga moadto sa pasilidad sa TB-DOTS.',
    pickDate: 'Petsa sa appointment',
    createCta: 'Paghimo og referral',
    missing: 'Pagpili og pasilidad ug petsa sa appointment.',
    alreadyExists: 'Aduna nay referral kining screening.',
    notFlagged: 'Ang mga screening lamang nga gi-flag sa checklist ang makahimo og referral.',
  },
  referralDoc: {
    title: 'Dokumento sa referral',
    heading: 'TB pre-screening referral',
    subheading: 'Pre-screening referral — DILI diagnosis. Ang mga pasilidad sa TB-DOTS ra ang maka-diagnose sa TB.',
    optionalNote:
      'Napadala na kining referral sa pasilidad sa TB-DOTS. Opsyonal ra ang pag-print — hatagi lang og kopya ang pasyente kung makatabang kini kaniya.',
    patientSection: 'Pasyente',
    patientCode: 'Code sa pasyente',
    screeningSection: 'Screening (DOH-NTP checklist)',
    screeningDate: 'Petsa sa screening',
    pgisLine: 'Kabug-at sa ubo sumala sa pasyente (PGI-S, dugang lamang): {{value}}',
    pgisNotRecorded: 'Kabug-at sa ubo sumala sa pasyente (PGI-S, dugang lamang): wala natala',
    vitalsSection: 'Mga vital sign (sumala sa sinukod)',
    vitalsNote:
      'Mga sukod lamang, gitala para sa pasilidad. Wala kini epekto sa rekomendasyon sa referral.',
    referralSection: 'Referral',
    facility: 'Nagadawat nga pasilidad',
    appointment: 'Appointment alang sa check-up',
    sputumNote: 'Sa pasilidad sa TB-DOTS gihimo ang pagkuha ug pagsusi sa plema.',
    preparedBy: 'Giandam ni (pirma sa BHW)',
    generatedAt: 'Nahimo niadtong {{date}}',
    qrCaption: 'I-scan sa pasilidad sa TB-DOTS aron maablihan kining referral.',
    printCta: 'I-print',
    shareCta: 'Ipaambit',
    printError: 'Dili maka-print: {{message}}',
    notFound: 'Wala makit-an ang referral niining device.',
  },
  vitals: {
    heading: 'Mga vital sign',
    intro:
      'Itala ang bisan unsa nga imong nasukod. Mahimong biyaan nga blangko ang bisan unsang luna, ug walay epekto sa referral kung laktawan kini nga lakang.',
    optionalTag: 'Opsyonal',
    height: 'Gitas-on',
    weight: 'Timbang',
    temperature: 'Temperatura',
    systolic: 'Systolic BP',
    diastolic: 'Diastolic BP',
    pulse: 'Kakusog sa pulso',
    spo2: 'Saturation sa oksiheno',
    bmi: 'BMI',
    bmiDerived: 'BMI, gikan sa gitas-on ug timbang',
    bloodPressure: 'Presyon sa dugo',
    unitCm: 'cm',
    unitKg: 'kg',
    unitC: '°C',
    unitMmHg: 'mmHg',
    unitBpm: 'bpm',
    unitPercent: '%',
    unitBmi: 'kg/m²',
    outOfRange: 'Susiha ang sukod nga adunay pula nga marka — morag sayop ang pagka-type.',
    fixBeforeContinuing: 'Ayoha ang sukod nga adunay pula nga marka',
    skipCta: 'Laktawan — walay nasukod',
  },
  screening: {
    checklistHeading: 'DOH-NTP symptom checklist',
    symptoms: {
      cough_2wks: 'Ubo nga 2 ka semana o labaw pa',
      weight_loss: 'Dili matin-aw nga pagkunhod sa timbang',
      night_sweats: 'Paningot sa gabii',
      fever: 'Dili matin-aw nga hilanat',
      hemoptysis: 'Pag-ubo og dugo (hemoptysis)',
      chest_pain: 'Sakit sa dughan',
      fatigue: 'Kakapoy / kaluya',
      loss_of_appetite: 'Kawala sa gana sa pagkaon',
      tb_contact: 'Suod nga kontak sa tawong nailhang adunay TB',
    },
    pgisHeading: 'Kabug-at sa ubo sumala sa pasyente (PGI-S)',
    pgisIntro:
      'Hangyoa ang pasyente nga motubag sa iyang kaugalingong pulong — kaugalingong tubag kini sa pasyente, dili imoha. Dugang impormasyon lamang — dili gyud kini makaapekto sa rekomendasyon alang sa referral.',
    pgisOptions: {
      none: 'Wala',
      mild: 'Gaan',
      moderate: 'Kasarangan',
      severe: 'Grabe',
    },
    outcomeTitleReferred: 'I-refer kining pasyente',
    outcomeTitleNot: 'Walay gi-flag nga referral',
    outcomeReferred:
      'Sumala sa checklist, gi-flag kining pasyente alang sa referral (presumptive TB).',
    reasonCardinal:
      'Rason: adunay bisan usa ka pangunang sintomas (ubo ≥ 2 ka semana, hilanat, paningot sa gabii, pagkunhod sa timbang, o pag-ubo og dugo) nga gitubag og “oo”.',
    reasonContact:
      'Rason: suod nga kontak sa tawong adunay TB ug adunay bisan usa ka gitaho nga sintomas.',
    outcomeNotReferred:
      'Sumala sa checklist, wala ma-flag kining pasyente alang sa referral.',
    notReferredAdvice:
      'Tambagi ang pasyente nga mobalik kung motungha o mograbe ang mga sintomas.',
    nonDiagnostic: 'Dili kini diagnosis. Ang TB-DOTS facility ra ang maka-diagnose sa TB.',
    saveCta: 'I-save ang screening',
    answerAll: 'Tubaga ang tanang aytem sa checklist una mag-save.',
    // TODO i18n verify (new step-flow strings)
    next: 'Sunod',
    answerFirst: 'Pilia una ang tubag',
    stepOf: '{{step}} / {{total}}',
    reviewTitle: 'Susiha ang mga tubag',
    reviewHint: 'Pislita ang tubag aron usbon una mahuman.',
    seeRecommendation: 'Tan-awa ang rekomendasyon',
    patientReportedTag: 'Tubag sa pasyente',
  },
};
