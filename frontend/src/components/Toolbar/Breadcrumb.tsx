/**
 * Breadcrumb navigation for drill-in/drill-out of nested MLIR regions.
 *
 * Displays the current view path as a clickable trail:
 *   Module > func.func @main > scf.for
 *
 * Clicking any segment navigates back to that level (drillOut).
 * The last segment is highlighted as the current level.
 */

interface BreadcrumbItem {
  /** Op ID for this breadcrumb segment */
  opId: string;
  /** Display label, e.g. "Module" or "func.func @main" */
  label: string;
}

interface BreadcrumbProps {
  /** Ordered breadcrumb items from root to current view */
  items: BreadcrumbItem[];
  /** Called when user clicks a breadcrumb to navigate back to that level */
  onNavigate: (index: number) => void;
}

export default function Breadcrumb({ items, onNavigate }: BreadcrumbProps) {
  // Don't render if there's only the root level (nothing to navigate back to)
  if (items.length <= 1) return null;

  return (
    <div style={{
      padding: '4px 16px',
      fontSize: 12,
      color: '#666',
      background: '#fafafa',
      borderBottom: '1px solid #f0f0f0',
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      flexWrap: 'wrap',
    }}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <span key={item.opId} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {/* Separator between segments */}
            {index > 0 && <span style={{ color: '#ccc' }}>{'>'}</span>}

            {isLast ? (
              /* Current level — bold, not clickable */
              <span style={{ fontWeight: 600, color: '#333' }}>
                {item.label}
              </span>
            ) : (
              /* Parent level — clickable link style */
              <span
                onClick={() => onNavigate(index)}
                style={{
                  cursor: 'pointer',
                  color: '#1890ff',
                  textDecoration: 'none',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
                onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
              >
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
