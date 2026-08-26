import type { SkillCase } from "../../src/index.js";

const TEST = `import { render, fireEvent } from "@testing-library/react";
import { jest } from "@jest/globals";

test("renders title", () => {
  const { container } = render(<CommentForm onSubmit={jest.fn()} />);
  expect(container.querySelector("h2").textContent).toBe("Add comment");
});
test("has a textarea", () => {
  const { getByTestId } = render(<CommentForm onSubmit={jest.fn()} />);
  expect(getByTestId("comment-input")).toBeTruthy();
});
test("calls onSubmit", () => {
  const onSubmit = jest.fn();
  const { getByTestId } = render(<CommentForm onSubmit={onSubmit} />);
  fireEvent.change(getByTestId("comment-input"), { target: { value: "hi" } });
  fireEvent.click(getByTestId("submit"));
  setTimeout(() => expect(onSubmit).toHaveBeenCalled(), 100);
});`;

export const cases: SkillCase[] = [
  {
    name: "rewrites a fragmented jest/fireEvent/testId spec into fewer user-flow tests with RTL queries and userEvent",
    kind: "quality",
    prompt: `This is our Vitest + RTL test for a comment form. Review it and rewrite it the way you'd want it.\n\n${TEST}`,
    practices: [
      "the three tiny tests are collapsed into one or two flow tests (happy path: type → submit → onSubmit called; validation: submit empty → error shown), and the answer explains the 'fewer, longer tests' reasoning",
      "imports come from vitest (vi.fn) and the rewrite uses screen.getByRole / getByLabelText instead of container.querySelector and getByTestId",
      "fireEvent is replaced with const user = userEvent.setup() and await user.type(...) / await user.click(...)",
      "the setTimeout assertion is replaced by await expect(...).toHaveBeenCalled after the awaited user events, or findBy / waitFor — no fixed delays",
      "assertions use jest-dom matchers such as toBeInTheDocument / toHaveValue rather than toBeTruthy on raw DOM nodes",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
];
