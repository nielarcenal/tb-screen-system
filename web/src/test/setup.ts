/**
 * Shared setup for the portal's Vitest suites.
 *
 * Importing ../i18n runs the real i18next init, so components under test get
 * the real strings instead of a stub `t`. Tests then assert against the locale
 * objects themselves (`en.detail.saveResult`) rather than hard-coded English,
 * so rewording a label does not break a suite.
 *
 * Auto-cleanup is not automatic here: @testing-library/react only registers it
 * when Vitest runs with `globals: true`, which this project does not.
 */
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import '../i18n';

afterEach(cleanup);
