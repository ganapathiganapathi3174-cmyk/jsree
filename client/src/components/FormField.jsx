/**
 * FormField — label + control + error/hint wrapper for consistent forms.
 *
 * Usage:
 *   <FormField label="Email" required error={errors.email}>
 *     <input className="input-field" ... />
 *   </FormField>
 */
export default function FormField({
  label,
  htmlFor,
  required = false,
  error = '',
  hint = '',
  children,
  className = '',
}) {
  return (
    <div className={className}>
      {label && (
        <label htmlFor={htmlFor} className={`label${required ? ' required' : ''}`}>
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="field-hint">{hint}</p>
      )}
    </div>
  );
}
