/**
 * react-native-paper-dates locale registration (Feature 6 date picker).
 * TODO i18n verify — tl/ceb strings are best-effort and must be reviewed by a
 * native speaker (brief §9). Unlisted keys fall back to the bundled English.
 */
import { en, registerTranslation } from 'react-native-paper-dates';

registerTranslation('en', en);

registerTranslation('tl', {
  ...en,
  save: 'I-save',
  selectSingle: 'Pumili ng petsa',
  selectMultiple: 'Pumili ng mga petsa',
  selectRange: 'Pumili ng saklaw',
  close: 'Isara',
  previous: 'Nakaraan',
  next: 'Susunod',
  typeInDate: 'I-type ang petsa',
  pickDateFromCalendar: 'Pumili ng petsa mula sa kalendaryo',
  dateIsDisabled: 'Hindi maaaring piliin ang araw na ito',
});

registerTranslation('ceb', {
  ...en,
  save: 'I-save',
  selectSingle: 'Pagpili og petsa',
  selectMultiple: 'Pagpili og mga petsa',
  selectRange: 'Pagpili og sakup',
  close: 'Sirad-i',
  previous: 'Miagi',
  next: 'Sunod',
  typeInDate: 'I-type ang petsa',
  pickDateFromCalendar: 'Pagpili og petsa gikan sa kalendaryo',
  dateIsDisabled: 'Dili mapili kini nga adlaw',
});
