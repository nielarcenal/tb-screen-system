/**
 * TODO i18n verify — Tagalog. These are best-effort translations and MUST be
 * reviewed by a native speaker before release (brief §9). Where phrasing is
 * uncertain, verify the medical/consent wording especially. Keep the
 * non-diagnostic positioning (§1): never imply the app detects/diagnoses TB.
 */
import type { Translation } from './en';

export const tl: Translation = {
  common: {
    appName: 'TB-Screen BHW',
    back: 'Bumalik',
    cancel: 'Kanselahin',
    continue: 'Magpatuloy',
    yes: 'Oo',
    no: 'Hindi',
    unsure: 'Hindi sigurado',
    outcomePositive: 'Positibo',
    outcomeNegative: 'Negatibo',
  },
  home: {
    title: 'TB-Screen BHW',
    signInBanner:
      'Mag-sign in para maka-sync at makapag-enroll ng pasyente. Mananatili sa device na ito ang mga naitala na.',
    sessionExpiredBanner:
      'Natapos ang session mo — mag-sign in ulit para makapag-sync. Nasa telepono pa rin ang mga pasyente at naitala mong trabaho.',
    signInCta: 'Mag-sign in',
    syncChipSynced: 'Naka-sync',
    syncChipSyncing: 'Nagsi-sync…',
    syncChipOffline: 'Offline',
    syncChipNever: 'Pindutin para mag-sync',
    lastSync: 'Huling na-sync {{date}}',
    neverSynced: 'Hindi pa nakapag-sync — pindutin ang button sa itaas kapag online.',
    syncOffline:
      'Hindi maka-sync ngayon — walang internet. Nakasave sa telepono na ito ang mga tala mo at awtomatikong magsi-sync kapag online ka na.',
    syncError:
      'Hindi maka-sync — pakisubukan ulit. Kung paulit-ulit, sabihin sa iyong coordinator: {{message}}',
    // Intl.PluralRules returns "one" for EVERY count in tl, so _one must carry
    // {{count}} — a hardcoded "1" here would be shown for any number.
    syncPartial:
      'May {{count}} talang hindi na-upload. Nai-sync naman ang iba. Nakasave pa rin ito sa teleponong ito at susubukan ulit — kung paulit-ulit ito, sabihin sa iyong coordinator.',
    syncPartial_one:
      'May {{count}} talang hindi na-upload. Nai-sync naman ang iba. Nakasave pa rin ito sa teleponong ito at susubukan ulit — kung paulit-ulit ito, sabihin sa iyong coordinator.',
    syncPartial_other:
      'May {{count}} talang hindi na-upload. Nai-sync naman ang iba. Nakasave pa rin ito sa teleponong ito at susubukan ulit — kung paulit-ulit ito, sabihin sa iyong coordinator.',
    primaryCta: 'Mag-enroll at mag-screen ng pasyente',
    attentionHeading: 'Kailangan ng atensyon',
    tiles: {
      upcoming: 'Paparating',
      missed: 'Hindi dumalo',
      noShow: 'No-show',
    },
    allCaughtUp: 'Tapos na lahat — walang kailangang i-follow up sa ngayon.',
    resultsSection: 'Mga bagong resulta',
    emptySection: 'Wala ritong laman sa ngayon.',
  },
  // TODO i18n verify
  followUps: {
    title: 'Mga follow-up',
    empty: 'Walang pasyente rito sa ngayon',
    emptySub: 'Lalabas dito ang mga pasyenteng na-flag ng TB-DOTS facility.',
  },
  tabs: {
    home: 'Home',
    patients: 'Mga Pasyente',
    settings: 'Mga Setting',
  },
  signIn: {
    title: 'Mag-sign in',
    intro:
      'Ang mga BHW account ay ibinibigay ng inyong program coordinator. Kailangan ng koneksyon sa pag-sign in; pagkatapos ay gumagana ang app offline.',
    email: 'Email',
    password: 'Password',
    showPassword: 'Ipakita ang password',
    hidePassword: 'Itago ang password',
    helper: 'Ang access ay ibinibigay ng inyong administrator. Makipag-ugnayan sa kanila kung hindi kayo makakapag-sign in.',
    cta: 'Mag-sign in',
    error: 'Nabigo ang pag-sign in: {{message}}',
    // TODO i18n verify
    errorOffline:
      'Kailangan ng koneksyon sa internet para makapag-sign in. Kapag naka-sign in na, gumagana ang app kahit offline.',
    // TODO i18n verify
    refusedInactive:
      'Na-deactivate na ang account na ito. Hilingin sa inyong barangay captain o program coordinator na i-activate itong muli.',
    refusedWrongRole:
      'Ang app na ito ay para sa mga Barangay Health Worker. Ang account ninyo ay {{destination}} — mag-sign in po sa TB-Screen portal sa computer.',
    refusedNoAccount:
      'Hindi pa nakahanda ang account na ito para sa app. Makipag-ugnayan po sa inyong program coordinator.',
  },
  /**
   * Blocked account (D-07). Shown over the whole app when the server says this
   * account may no longer use it.
   */
  // TODO i18n verify
  blocked: {
    inactiveTitle: 'Na-deactivate na ang account na ito',
    inactiveBody:
      'Hindi na ninyo magagamit ang app gamit ang account na ito. Hilingin sa inyong barangay captain o program coordinator na i-activate itong muli.',
    wrongRoleTitle: 'Ang app na ito ay para sa mga Barangay Health Worker',
    wrongRoleBody:
      'Ang account ninyo ay {{destination}}. Mag-sign in po sa TB-Screen portal sa computer.',
    noAccountTitle: 'Hindi nakahanda ang account na ito',
    noAccountBody:
      'Hindi namin makita ang mga detalye ng account na ito. Makipag-ugnayan po sa inyong program coordinator.',
    roleFacility: 'isang account ng health facility',
    roleCaptain: 'isang account ng barangay captain',
    roleAdmin: 'isang account ng administrator',
    roleOther: 'hindi account ng Barangay Health Worker',
    pendingNote:
      'Kapag nag-sign out, iuupload muna ang mga naghihintay pa. Kung may mga record na hindi maiupload, tatanungin muna kayo bago may burahin sa telepono na ito.',
    signOut: 'Mag-sign out',
  },
  /**
   * Forced password change (D-06). Shown over the whole app while the account
   * still holds the password its captain or admin provisioned.
   */
  password: {
    gateTitle: 'Gumawa ng sarili mong password',
    gateSub:
      'Ginagamit pa ng account na ito ang password na ibinigay ng iyong coordinator. Pumili ng password na ikaw lang ang nakakaalam bago magpatuloy.',
    signedInAs: 'Naka-sign in bilang {{email}}',
    newLabel: 'Bagong password',
    confirmLabel: 'Kumpirmahin ang bagong password',
    hint: 'Hindi bababa sa {{min}} karakter. Huwag gamitin muli ang password na ibinigay sa iyo.',
    cta: 'I-save ang password at magpatuloy',
    saving: 'Nagse-save…',
    signOut: 'Mag-sign out na lang',
    errTooShort: 'Gumamit ng hindi bababa sa {{min}} karakter.',
    errLooksProvisioned:
      'Iyan ay password na ginawa ng sistema. Pumili ng sarili mong password.',
    errMismatch: 'Hindi magkatugma ang dalawang password.',
    errApi: 'Hindi na-save ang password: {{message}}',
    errFlag:
      'Napalitan ang iyong password, ngunit hindi natapos ang telepono na ito. Mag-sign in muli gamit ang bagong password.',
  },
  status: {
    submitted: 'Naisumite',
    received: 'Natanggap',
    tested: 'Nasuri',
    closed: 'Sarado',
  },
  welcome: {
    disclaimerHeading: 'Hindi nagsusuri ng TB ang app na ito',
    disclaimerBody:
      'Sinusuportahan ng app na ito ang pre-screening at referral para sa tuberculosis (TB). HINDI nito dinidiyagnos ang TB at hindi masasabi kung may TB ang isang tao. Ang mga pasilidad ng TB-DOTS lamang ang makakapag-diyagnos ng TB sa pamamagitan ng laboratory testing. Tumutulong lamang ang app na ito na matukoy ang mga taong maaaring kailanganing i-refer para sa testing (presumptive TB).',
    termsHeading: 'Mga tuntunin at privacy ng datos',
    termsBody:
      'Ang personal na impormasyon ay kinokolekta lamang upang suportahan ang referral at follow-up. Ang contact number ng pasyente ay iniimbak lamang kung sumang-ayon ang pasyente na tumanggap ng SMS reminders. Ang impormasyon ay ibinabahagi lamang sa tumatanggap na pasilidad ng TB-DOTS. Sa pagpapatuloy, sumasang-ayon kang gamitin ang tool na ito nang responsable at ipaliwanag ang layunin nito sa bawat pasyente sa kanilang sariling wika.',
    acceptCta: 'Nauunawaan ko at sumasang-ayon ako',
    // TODO i18n verify
    tagline: 'Kasangkapan sa paunang pagsusuri para sa mga Barangay Health Worker',
    languageHint: 'Maaari itong palitan anumang oras sa Settings',
  },
  terms: {
    title: 'Mga tuntunin at disclaimer',
    acceptedOn: 'Tinanggap mo ang mga tuntuning ito noong {{date}}.',
    notAccepted: 'Hindi pa tinatanggap.',
  },
  settings: {
    title: 'Mga Setting',
    accountSection: 'Account',
    signIn: 'Mag-sign in',
    signOut: 'Mag-sign out',
    // TODO i18n verify
    signOutConfirmTitle: 'Mag-sign out?',
    signOutConfirmBody:
      'Buburahin ang mga offline na tala sa teleponong ito upang hindi makita ng susunod na account. Ita-upload muna ang mga hindi pa nai-sync — kung may hindi maita-upload, tatanungin ka muna bago ito burahin.',
    signOutSyncing: 'Nagsi-sync…',
    signOutPendingTitle: 'May hindi pa nai-upload',
    signOutPendingBody:
      'May {{count}} talang hindi pa nakakarating sa server. Kapag nag-sign out ka, permanente itong mabubura. Kung kaya, kumonekta muna sa internet at mag-sync bago mag-sign out.',
    signOutPendingBody_one:
      'May {{count}} talang hindi pa nakakarating sa server. Kapag nag-sign out ka, permanente itong mabubura. Kung kaya, kumonekta muna sa internet at mag-sync bago mag-sign out.',
    signOutPendingBody_other:
      'May {{count}} talang hindi pa nakakarating sa server. Kapag nag-sign out ka, permanente itong mabubura. Kung kaya, kumonekta muna sa internet at mag-sync bago mag-sign out.',
    staySignedIn: 'Manatiling naka-sign in',
    signOutDiscard: 'Mag-sign out at burahin',
    languageSection: 'Wika',
    legalSection: 'Legal',
    viewTerms: 'Tingnan ang mga tuntunin at disclaimer',
    developerSection: 'Developer',
    resetFirstLaunch: 'I-reset ang first-launch (ipakita muli ang welcome)',
    assignedSection: 'Aking nakatalagang barangay',
    assignedHint:
      'Ginagamit para paunang punan ang address kapag nag-e-enroll ng pasyente. Maaari mo pa ring baguhin ang address para sa bawat pasyente.',
    assignedPendingPush:
      'Nai-save sa device na ito — maa-update ang iyong profile kapag online.',
  },
  address: {
    region: 'Rehiyon',
    province: 'Probinsya',
    city: 'Lungsod / Munisipalidad',
    barangay: 'Barangay',
    sitio: 'Sitio / Purok (opsyonal)',
    search: 'Maghanap…',
  },
  consent: {
    heading: 'Pahintulot ng pasyente',
    intro:
      'Ipaliwanag ang layunin ng pre-screening na ito sa pasyente sa kanilang sariling wika bago magpatuloy.',
    confirmLabel: 'Pumapayag ang pasyente sa pre-screening at referral.',
    smsOptInLabel: 'Magpadala ng SMS reminders para sa check-up sa pasyenteng ito',
    smsHint: 'Kung sumang-ayon lamang ang pasyente. Kailangan ng mobile number para makapagpadala ng SMS.',
    contactNumberLabel: 'Mobile number',
    smsLanguageLabel: 'Wika ng mga SMS reminder',
    contactNumberPlaceholder: '09XXXXXXXXX',
    contactNumberError: 'Maglagay ng wastong mobile number, o i-off ang SMS reminders.',
    nonDiagnosticReminder: 'Paalala: sinusuportahan lamang ng tool na ito ang referral. Hindi ito nagdidiyagnos ng TB.',
  },
  sex: {
    male: 'Lalaki',
    female: 'Babae',
  },
  patients: {
    title: 'Mga Pasyente',
    empty: 'Wala pang pasyente sa device na ito. Mag-enroll ng pasyente para magsimula.',
    noMatch: 'Walang pasyenteng tumutugma sa code na iyan.',
    searchPlaceholder: 'Maghanap ng pasyente…',
    enrollCta: 'I-enroll ang pasyente',
    itemDescription: '{{sex}}, {{age}} taon',
  },
  enroll: {
    title: 'I-enroll ang pasyente',
    intro:
      'Awtomatikong bibigyan ng patient code (hal. PAT-XXXX-0001) sa pag-save. Ang detalye ng pasyente ay ibinabahagi lamang sa tumatanggap na TB-DOTS facility.',
    requiredHint: 'Kinakailangan ang mga field na may markang *.',
    fullNameLabel: 'Buong pangalan',
    firstNameLabel: 'Pangalan',
    middleNameLabel: 'Gitnang pangalan',
    lastNameLabel: 'Apelyido',
    birthdateLabel: 'Petsa ng kapanganakan',
    ageLabel: 'Edad',
    sexLabel: 'Kasarian',
    addressSection: 'Address',
    addressHint:
      'Paunang napunan mula sa iyong nakatalagang barangay. Baguhin kung sa ibang lugar nakatira ang pasyente.',
    signInRequired:
      'Mag-sign in muna bago mag-enroll — bawat rekord ay dapat nakatala sa account ng BHW. (Pansamantala, nasa developer sync-test screen ang sign-in.)',
    goToSignIn: 'Pumunta sa sign-in',
    saveCta: 'I-enroll ang pasyente',
    missingFields:
      'Kumpletuhin ang mga kinakailangang field: pahintulot, pangalan, petsa ng kapanganakan, kasarian, at barangay.',
  },
  patientDetail: {
    ageSex: 'Edad at kasarian',
    smsLabel: 'SMS reminders',
    smsOptedIn: 'Oo — {{number}}',
    smsDeclined: 'Hindi',
    syncPending: 'Naghihintay ma-sync',
    syncSynced: 'Na-sync na',
    screeningsSection: 'Mga screening',
    noScreenings: 'Wala pang naitalang screening.',
    startScreening: 'Simulan ang screening',
    flaggedChip: 'Na-flag para sa referral',
    notFlaggedChip: 'Hindi na-flag',
    pgisShort: 'Tindi ng ubo (PGI-S): {{value}}',
    notFound: 'Hindi natagpuan ang pasyente sa device na ito.',
    createReferral: 'Gumawa ng referral',
    viewSpecimen: 'Specimen form',
    noShowChip: 'No-show',
    resultRecorded: 'Naitala ang resulta noong {{date}}',
    resultPositive:
      'POSITIBO ang naitalang resulta ng pasilidad. Siguraduhing bumalik ang pasyente sa TB-DOTS na pasilidad para magsimula ng gamutan.',
    resultNegative:
      'NEGATIBO ang naitalang resulta ng pasilidad. Ang pasilidad ang magsasabi ng mga susunod na hakbang.',
    resultAskFacility: 'Para sa detalye, magtanong sa TB-DOTS na pasilidad.',
    // TODO i18n verify
    appt: {
      scheduled: 'Paparating',
      attended: 'Dumalo',
      missed: 'Hindi natupad',
    },
    editDetails: 'Baguhin ang detalye',
    saveChanges: 'I-save ang mga pagbabago',
    enrolledBy: 'In-enroll ni {{name}} (BHW)',
  },
  referral: {
    title: 'Gumawa ng referral',
    screeningSummary: 'Screening noong {{date}}',
    facilitySection: 'Tumatanggap na pasilidad ng TB-DOTS',
    noFacilities:
      'Wala pang pasilidad ng TB-DOTS sa device na ito. Mag-sync nang isang beses habang online para ma-download ang listahan ng mga pasilidad.',
    appointmentSection: 'Appointment para sa check-up',
    appointmentHint: 'Ang petsa kung kailan hihilingin sa pasyente na pumunta sa pasilidad ng TB-DOTS.',
    pickDate: 'Petsa ng appointment',
    createCta: 'Gumawa ng referral',
    missing: 'Pumili ng pasilidad at petsa ng appointment.',
    alreadyExists: 'May referral na ang screening na ito.',
    notFlagged: 'Ang mga screening lamang na na-flag ng checklist ang maaaring gumawa ng referral.',
  },
  specimen: {
    title: 'Specimen form',
    heading: 'TB specimen referral form',
    subheading: 'Pre-screening referral — HINDI diagnosis. Ang mga pasilidad ng TB-DOTS lamang ang nagdidiyagnos ng TB.',
    specimenId: 'Specimen ID',
    patientSection: 'Pasyente',
    patientCode: 'Code ng pasyente',
    screeningSection: 'Screening (DOH-NTP checklist)',
    screeningDate: 'Petsa ng screening',
    pgisLine: 'Tindi ng ubo ayon sa pasyente (PGI-S, karagdagan lamang): {{value}}',
    pgisNotRecorded: 'Tindi ng ubo ayon sa pasyente (PGI-S, karagdagan lamang): hindi naitala',
    referralSection: 'Referral',
    facility: 'Tumatanggap na pasilidad',
    appointment: 'Appointment para sa check-up',
    preparedBy: 'Inihanda ni (lagda ng BHW)',
    generatedAt: 'Nabuo noong {{date}}',
    qrCaption: 'I-scan sa pasilidad ng TB-DOTS para buksan ang referral na ito.',
    printCta: 'I-print',
    shareCta: 'Ibahagi',
    printError: 'Hindi maka-print: {{message}}',
    notFound: 'Hindi natagpuan ang referral sa device na ito.',
  },
  screening: {
    checklistHeading: 'DOH-NTP symptom checklist',
    symptoms: {
      cough_2wks: 'Ubo nang 2 linggo o higit pa',
      weight_loss: 'Hindi maipaliwanag na pagbaba ng timbang',
      night_sweats: 'Pagpapawis sa gabi',
      fever: 'Hindi maipaliwanag na lagnat',
      hemoptysis: 'Pag-ubo ng dugo (hemoptysis)',
      chest_pain: 'Pananakit ng dibdib',
      fatigue: 'Pagkapagod / panghihina',
      loss_of_appetite: 'Kawalan ng gana sa pagkain',
      tb_contact: 'Malapit na kontak sa taong may alam na TB',
    },
    pgisHeading: 'Tindi ng ubo ayon sa pasyente (PGI-S)',
    pgisIntro:
      'Hilingin sa pasyenteng sumagot sa sarili niyang salita — sariling sagot ito ng pasyente, hindi sa iyo. Karagdagang impormasyon lamang — hindi ito nakakaapekto sa rekomendasyon para sa referral.',
    pgisOptions: {
      none: 'Wala',
      mild: 'Banayad',
      moderate: 'Katamtaman',
      severe: 'Malala',
    },
    outcomeTitleReferred: 'I-refer ang pasyenteng ito',
    outcomeTitleNot: 'Walang na-flag na referral',
    outcomeReferred:
      'Ayon sa checklist, na-flag ang pasyenteng ito para sa referral (presumptive TB).',
    reasonCardinal:
      'Dahilan: may kahit isang pangunahing sintomas (ubo ≥ 2 linggo, lagnat, pagpapawis sa gabi, pagbaba ng timbang, o pag-ubo ng dugo) na sinagot ng “oo”.',
    reasonContact:
      'Dahilan: malapit na kontak sa taong may TB at may kahit isang naiulat na sintomas.',
    outcomeNotReferred:
      'Ayon sa checklist, hindi na-flag ang pasyenteng ito para sa referral.',
    notReferredAdvice: 'Payuhan ang pasyente na bumalik kung lumitaw o lumala ang mga sintomas.',
    nonDiagnostic:
      'Hindi ito diagnosis. Ang pasilidad ng TB-DOTS lamang ang makakapag-diyagnos ng TB.',
    saveCta: 'I-save ang screening',
    answerAll: 'Sagutan ang lahat ng aytem ng checklist bago mag-save.',
    // TODO i18n verify (new step-flow strings)
    next: 'Susunod',
    answerFirst: 'Pumili muna ng sagot',
    stepOf: '{{step}} / {{total}}',
    reviewTitle: 'Suriin ang mga sagot',
    reviewHint: 'Pindutin ang sagot upang baguhin bago tapusin.',
    seeRecommendation: 'Tingnan ang rekomendasyon',
    patientReportedTag: 'Sagot ng pasyente',
  },
};
