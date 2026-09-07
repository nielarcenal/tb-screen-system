/**
 * AccountStateGate — the portal's terminal account states (D-12).
 *
 * What these pin is not the wording but the ESCAPE. The defect being fixed was
 * a screen with no control on it at all: `me === null` rendered "Loading…" and
 * nothing ever cleared it, so a network blip during the profile lookup stranded
 * the user in a browser tab they could only fix by clearing site data. So every
 * test here asserts a sign-out is reachable, and that Retry appears on exactly
 * the one state that can be retried.
 *
 * Strings are read from the en bundle rather than typed in, so rewording copy
 * does not break the suite (see src/test/setup.ts).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { en } from '../i18n/locales/en';
import AccountStateGate, { AccountState } from './AccountStateGate';

const mock = vi.hoisted(() => ({ signOut: vi.fn(() => Promise.resolve({ error: null })) }));

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { signOut: mock.signOut } },
}));

const ALL: AccountState[] = ['error', 'missing', 'inactive'];

describe('AccountStateGate', () => {
  it.each(ALL)('offers a sign-out in the %s state', (state) => {
    mock.signOut.mockClear();
    render(<AccountStateGate state={state} email="staff@example.test" />);

    const out = screen.getByRole('button', { name: new RegExp(en.common.signOut, 'i') });
    fireEvent.click(out);

    // scope:'local' — this browser only, matching the sidebar control. Signing
    // out globally would kill the user's phone session from a stuck web tab.
    expect(mock.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('shows the retry control only for the retryable state', () => {
    const retry = vi.fn();
    const { rerender } = render(
      <AccountStateGate state="error" onRetry={retry} email={null} />,
    );
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.common.refresh, 'i') }));
    expect(retry).toHaveBeenCalledTimes(1);

    // 'missing' and 'inactive' are facts about the account, not transport
    // failures: re-asking the server returns the same answer, so offering a
    // Retry there would be a button that visibly does nothing.
    for (const state of ['missing', 'inactive'] as const) {
      rerender(<AccountStateGate state={state} onRetry={retry} email={null} />);
      expect(
        screen.queryByRole('button', { name: new RegExp(en.common.refresh, 'i') }),
      ).toBeNull();
    }
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('names the state it is in, and the account that is stuck', () => {
    render(<AccountStateGate state="inactive" email="midwife@example.test" />);
    expect(screen.getByText(en.account.inactiveTitle)).toBeTruthy();
    expect(screen.getByText(en.account.inactiveBody)).toBeTruthy();
    expect(screen.getByText('midwife@example.test')).toBeTruthy();
  });

  it('renders without an email rather than printing a blank chip', () => {
    const { container } = render(<AccountStateGate state="missing" email={null} />);
    expect(screen.getByText(en.account.missingTitle)).toBeTruthy();
    expect(container.querySelector('.st-who')).toBeNull();
  });
});
