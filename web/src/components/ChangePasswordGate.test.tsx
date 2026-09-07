/**
 * ChangePasswordGate — the D-06 forced password change (portal side).
 *
 * The order of the two server calls is the whole point of this suite. The
 * password change and the flag clear are separate operations that cannot be
 * made atomic from a browser, so the gate must call them in the one order that
 * fails safely — change the password first, clear the flag second — and must
 * never tell the user "could not save" once the password has actually changed,
 * which would send them back to a password that no longer works.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { en } from '../i18n/locales/en';
import ChangePasswordGate from './ChangePasswordGate';

const mock = vi.hoisted(() => {
  const calls = {
    /** Passwords passed to auth.updateUser, in order. */
    updates: [] as string[],
    /** RPC names called, in order. */
    rpcs: [] as string[],
    /** Options passed to auth.signOut. */
    signOuts: [] as unknown[],
  };
  const fail = {
    update: null as { message: string } | null,
    rpc: null as { message: string } | null,
  };

  const supabase = {
    auth: {
      updateUser: ({ password }: { password: string }) => {
        calls.updates.push(password);
        return Promise.resolve({ error: fail.update });
      },
      signOut: (options?: unknown) => {
        calls.signOuts.push(options);
        return Promise.resolve({ error: null });
      },
    },
    rpc: (name: string) => {
      calls.rpcs.push(name);
      return Promise.resolve({ error: fail.rpc });
    },
  };

  return { calls, fail, supabase };
});

vi.mock('../lib/supabase', () => ({ supabase: mock.supabase }));

/**
 * Fields are found by id rather than by label text: PasswordField puts a
 * Material Symbols ligature ("visibility") inside the label's show/hide button,
 * so the label's text content is not just its caption. The ids are the
 * component's own contract with those <label htmlFor> attributes.
 */
const field = (id: string) => document.querySelector(`#${id}`) as HTMLInputElement;
const newPassword = () => field('new-password');
const confirmPassword = () => field('confirm-password');
const saveButton = () => screen.getByRole('button', { name: en.password.cta });

/** Type the same value into both fields, the normal case. */
function typeBoth(value: string, confirmValue = value) {
  fireEvent.change(newPassword(), { target: { value } });
  fireEvent.change(confirmPassword(), { target: { value: confirmValue } });
}

let done: number;

function renderGate(email: string | null = 'bhw@example.test') {
  done = 0;
  render(<ChangePasswordGate email={email} onDone={() => (done += 1)} />);
}

beforeEach(() => {
  mock.calls.updates = [];
  mock.calls.rpcs = [];
  mock.calls.signOuts = [];
  mock.fail.update = null;
  mock.fail.rpc = null;
});

describe('ChangePasswordGate — refusing a password before any request', () => {
  it('refuses one under the minimum length', async () => {
    renderGate();
    typeBoth('short12');
    fireEvent.click(saveButton());

    expect(await screen.findByText(en.password.errTooShort.replace('{{min}}', '8'))).toBeTruthy();
    expect(mock.calls.updates).toEqual([]);
  });

  it('refuses a password in the provisioned format', async () => {
    renderGate();
    typeBoth('TBS-4829-kfmq');
    fireEvent.click(saveButton());

    expect(await screen.findByText(en.password.errLooksProvisioned)).toBeTruthy();
    expect(mock.calls.updates).toEqual([]);
  });

  it('refuses a mismatched confirmation', async () => {
    renderGate();
    typeBoth('malakas na tao', 'malakas na tap');
    fireEvent.click(saveButton());

    expect(await screen.findByText(en.password.errMismatch)).toBeTruthy();
    expect(mock.calls.updates).toEqual([]);
  });

  it('keeps the button disabled until both fields have something in them', () => {
    renderGate();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(newPassword(), { target: { value: 'malakas na tao' } });
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(confirmPassword(), { target: { value: 'malakas na tao' } });
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('ChangePasswordGate — saving', () => {
  it('changes the password, then clears the flag, then releases the gate', async () => {
    renderGate();
    typeBoth('malakas na tao');
    fireEvent.click(saveButton());

    await waitFor(() => expect(done).toBe(1));
    expect(mock.calls.updates).toEqual(['malakas na tao']);
    expect(mock.calls.rpcs).toEqual(['clear_password_change_flag']);
  });

  it('does not clear the flag when the password change failed', async () => {
    mock.fail.update = { message: 'Password should be at least 10 characters' };
    renderGate();
    typeBoth('malakas na tao');
    fireEvent.click(saveButton());

    await waitFor(() => expect(mock.calls.updates).toHaveLength(1));
    // The server's own reason is surfaced verbatim — its policy may be stricter
    // than ours, and only it knows what it refused.
    expect(
      await screen.findByText(/Password should be at least 10 characters/),
    ).toBeTruthy();
    expect(mock.calls.rpcs).toEqual([]);
    expect(done).toBe(0);
  });

  it('says the password DID change when only the flag clear failed', async () => {
    mock.fail.rpc = { message: 'permission denied for function' };
    renderGate();
    typeBoth('malakas na tao');
    fireEvent.click(saveButton());

    await waitFor(() => expect(mock.calls.rpcs).toHaveLength(1));
    expect(mock.calls.updates).toEqual(['malakas na tao']); // it really did change
    // Anything that reads as "we could not save it" would send the user back to
    // a password that no longer works.
    expect(await screen.findByText(en.password.errFlag)).toBeTruthy();
    expect(screen.queryByText(en.password.errMismatch)).toBeNull();
    // The gate stays up — the flag is still set, so the next load would show it
    // anyway; releasing here would just move the surprise.
    expect(done).toBe(0);
  });
});

describe('ChangePasswordGate — the way out', () => {
  it('offers sign-out, scoped to this browser only', async () => {
    renderGate();
    fireEvent.click(screen.getByRole('button', { name: en.password.signOut }));

    await waitFor(() => expect(mock.calls.signOuts).toHaveLength(1));
    // 'global' would revoke the account everywhere, including the BHW's phone.
    expect(mock.calls.signOuts[0]).toEqual({ scope: 'local' });
  });

  it('shows which account is being changed', () => {
    renderGate('midwife@example.test');
    expect(screen.getByText(/midwife@example\.test/)).toBeTruthy();
  });

  it('renders without an email rather than showing an empty line', () => {
    renderGate(null);
    expect(screen.getByRole('button', { name: en.password.cta })).toBeTruthy();
    expect(screen.queryByText(/Signed in as/)).toBeNull();
  });
});
