/**
 * LoginForm — the facility/midwife page split, and the property that survived
 * the role toggle it replaced (was D-11).
 *
 * The old page served both clinical roles and offered a staff/midwife pill
 * pair. The pills selected the explanatory note and nothing else, and the test
 * that mattered was the one pinning that "nothing else": sending the picked
 * role to Supabase would have refused correct credentials over a mis-tap, and
 * would have told any anonymous visitor which role an email belongs to.
 *
 * The pills are gone — each role has its own page now, so there is nothing left
 * to pick. THE PROPERTY IS NOT GONE. `portal` is a prop rather than a pressed
 * button, but it is still a caller-supplied claim about a role, and it still
 * must not reach the auth call. The second test below is the same guard as
 * before, re-aimed at the thing that replaced the pills: it is what fails if
 * someone later decides the midwife page should "only accept midwives".
 *
 * A wrong-page sign-in is corrected AFTER authentication, by the redirect in
 * App, where the role is actually known.
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

describe('LoginForm', () => {
  it('names the portal it belongs to, and explains that role', () => {
    const { unmount } = render(<LoginForm portal="facility" />);

    expect(screen.getByText(en.shell.facilityPortal)).toBeTruthy();
    expect(screen.getByText(en.login.noteStaff)).toBeTruthy();
    expect(screen.queryByText(en.login.noteMidwife)).toBeNull();
    unmount();

    render(<LoginForm portal="midwife" />);

    expect(screen.getByText(en.shell.midwifePortal)).toBeTruthy();
    expect(screen.getByText(en.login.noteMidwife)).toBeTruthy();
    expect(screen.queryByText(en.login.noteStaff)).toBeNull();
  });

  it('offers a link to the other clinical portal, not to its own', () => {
    const { unmount } = render(<LoginForm portal="facility" />);
    expect(screen.getByRole('link', { name: en.login.goMidwife }).getAttribute('href')).toBe(
      '/midwife.html',
    );
    unmount();

    render(<LoginForm portal="midwife" />);
    expect(screen.getByRole('link', { name: en.login.goFacility }).getAttribute('href')).toBe('/');
  });

  it('signs in with the credentials alone — `portal` is never sent', async () => {
    mock.signIn.mockClear();
    // The midwife page, signed into with an account that will resolve to
    // TB-DOTS staff. This must reach Supabase as an ordinary sign-in.
    render(<LoginForm portal="midwife" />);

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
    render(<LoginForm portal="facility" />);

    fireEvent.change(screen.getByLabelText(en.login.email), {
      target: { value: 'staff@example.test' },
    });
    fireEvent.change(screen.getByLabelText(en.login.password), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: en.login.cta }));

    await waitFor(() => expect(screen.getByText(/Invalid login credentials/)).toBeTruthy());
  });
});
