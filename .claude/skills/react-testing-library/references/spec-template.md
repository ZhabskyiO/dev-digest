# Complete Spec Template

This is what a well-structured test file looks like. Each test walks through a real user flow.

```jsx
// BlogList.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import BlogList from './BlogList';

// --- MSW setup: mock the API at the network level ---
const blogs = [
  { _id: '1', title: 'First Post', category: 'Technology', excerpt: 'About tech' },
  { _id: '2', title: 'Second Post', category: 'Startup', excerpt: 'About startups' },
];

const server = setupServer(
  http.get('/api/blogs', () => HttpResponse.json({ success: true, blogs })),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// --- Render helper (keeps tests DRY) ---
const renderBlogList = () =>
  render(<MemoryRouter><BlogList /></MemoryRouter>);

// --- Tests: 3 tests covering ALL real scenarios ---
describe('BlogList', () => {
  it('loads blogs and lets user navigate to a post', async () => {
    const user = userEvent.setup();
    renderBlogList();

    // Loading state appears first
    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    // Blogs appear after fetch
    expect(await screen.findByText('First Post')).toBeInTheDocument();
    expect(screen.getByText('Second Post')).toBeInTheDocument();

    // User clicks a blog card
    await user.click(screen.getByRole('link', { name: /first post/i }));
    // Assert navigation happened (or verify detail view renders)
  });

  it('shows empty state when no blogs exist', async () => {
    server.use(
      http.get('/api/blogs', () => HttpResponse.json({ success: true, blogs: [] })),
    );
    renderBlogList();

    expect(await screen.findByText(/no blogs/i)).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('shows error message when API fails', async () => {
    server.use(
      http.get('/api/blogs', () => HttpResponse.json(
        { success: false, message: 'Server error' },
        { status: 500 },
      )),
    );
    renderBlogList();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});
```

### Form Spec Template

```jsx
// LoginForm.test.jsx
describe('LoginForm', () => {
  it('logs in with valid credentials and shows dashboard', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LoginForm /></MemoryRouter>);

    // Fill form
    await user.type(screen.getByLabelText(/email/i), 'admin@test.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Success: redirected or success message
    expect(await screen.findByText(/welcome/i)).toBeInTheDocument();
  });

  it('shows validation errors when submitted empty', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LoginForm /></MemoryRouter>);

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Both fields show errors
    expect(await screen.findByText(/email is required/i)).toBeInTheDocument();
    expect(screen.getByText(/password is required/i)).toBeInTheDocument();

    // Form is still visible (not redirected)
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows server error when API returns 401', async () => {
    server.use(
      http.post('/api/admin/login', () =>
        HttpResponse.json({ success: false, message: 'Invalid credentials' }, { status: 401 }),
      ),
    );
    const user = userEvent.setup();
    render(<MemoryRouter><LoginForm /></MemoryRouter>);

    await user.type(screen.getByLabelText(/email/i), 'admin@test.com');
    await user.type(screen.getByLabelText(/password/i), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
  });
});
```
