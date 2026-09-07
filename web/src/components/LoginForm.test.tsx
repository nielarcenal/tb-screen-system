/**
 * LoginForm — the staff/midwife role toggle (D-11).
 *
 * Two properties are pinned here, and they pull against each other:
 *
 *  1. The pills must DO something. They carry `aria-pressed`, which tells a
 *     screen-reader user they select a state; before this fix the `role` state
 *     was written by the click handlers and read nowhere, so the control
 *     announced a selection that changed nothing on screen.
 *
 *  2. The pills must NOT reach sign-in. Sending the picked role to Supabase
 *     would refuse correct credentials over a mis-tap, and would leak which
 *     role an email belongs to. So the credentials sent must be exactly the
 *     email and the password, whichever pill is lit.
 *
 * Test 2 is the one that matters long-term: it is what fails if someone
 * "finishes" D-11 later by wiring the toggle into the auth call.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { en } from '../i18n/locales/en';
import LoginForm from './LoginForm';

const mock = vi.hoisted(() => ({
  // `error` is widened deliberately: inferred from the happy path alone it
  // would be `null`, and the failure test's mockResolvedValueOnce would not
  // typecheck against it.
  signIn: vi.fn((_credentials: { email: string; password: string }) =>
    Promise.resolve({ data: {}, error: null as { message: string } | null }),
  ),
}));

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: mock.signIn } },
}));

const pill = (name: string) => screen.getByRole('button', { name });

describe('LoginForm role toggle', () => {
  it('selects the note under the pills, and reflects it in aria-pressed', () => {
    render(<LoginForm />);

    // Staff is the default.
    expect(pill(en.login.roleStaff).getAttribute('aria-pressed')).toBe('true');
    expect(pill(en.login.roleMidwife).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText(en.login.noteStaff)).toBeTruthy();
    expect(screen.queryByText(en.login.noteMidwife)).toBeNull();

    fireEvent.click(pill(en.login.roleMidwife));

    expect(pill(en.login.roleMidwife).getAttribute('aria-pressed')).toBe('true');
    expect(pill(en.login.roleStaff).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText(en.login.noteMidwife)).toBeTruthy();
    expect(screen.queryByText(en.login.noteStaff)).toBeNull();
  });

  it('signs in with the credentials alone — the picked role is never sent', async () => {
    mock.signIn.mockClear();
    render(<LoginForm />);

    // Pick the pill that does NOT match how this account will actually resolve.
    fireEvent.click(pill(en.login.roleMidwife));
    fireEvent.change(screen.getByLabelText(en.login.email), {
      target: { value: 'staff@example.test' },
    });
    fireEvent.change(screen.getByLabelText(en.login.password), {
      target: { value: 'correct-horse' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.login.cta }));

    await waitFor(() => expect(mock.signIn).toHaveBeenCalledTimes(1));
    expect(mock.signIn).toHaveBeenCalledWith({
      email: 'staff@example.test',
      password: 'correct-horse',
    });
  });

  it('surfaces a sign-in failure instead of failing silently', async () => {
    mock.signIn.mockClear();
    mock.signIn.mockResolvedValueOnce({ data: {}, error: { message: 'Invalid login credentials' } });
    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText(en.login.email), {
      target: { value: 'staff@example.test' },
    });
    fireEvent.change(screen.getByLabelText(en.login.password), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: en.login.cta }));

    await waitFor(() =>
      expect(screen.getByText(/Invalid login credentials/)).toBeTruthy(),
    );
  });
});
