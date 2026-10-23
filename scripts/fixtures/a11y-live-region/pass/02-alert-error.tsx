/**
 * PASS fixture — an error announcement.
 *
 * WCAG 2.2 SC 4.1.3 (AA): a failure is the one case where an assertive
 * announcement is warranted, and `role="alert"` is the sanctioned
 * spelling (it implies `aria-live="assertive"` without writing it). This
 * file must produce NO violation.
 */
export const AlertError = ({ message }: { message: string }) => <p role="alert">{message}</p>;
