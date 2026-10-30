import type { RcmEditorLabels } from '../labels';

export interface HtmlNoticeItem {
  /** `rawHtml[].reason` (`element` | `attribute` | `style`) or `policyRemoved[].kind`. */
  reason: string;
  /** Human-readable line (detail + snippet); tests never assert this text. */
  text: string;
}

export interface HtmlNoticeProps {
  items: readonly HtmlNoticeItem[];
  labels: RcmEditorLabels;
  onClose: () => void;
}

/**
 * Non-blocking notice after a source apply / raw-fragment action: every fragment kept
 * verbatim as `rawHtml` and everything the policy removed is listed — nothing disappears
 * silently. Not shown for the initial load.
 */
export function HtmlNotice({ items, labels, onClose }: HtmlNoticeProps) {
  return (
    <div className="rcm-html-notice" role="status" data-testid="rcm-html-notice">
      <span className="rcm-html-notice-title">{labels.htmlNotice}</span>
      <ul className="rcm-html-notice-list">
        {items.map((item, index) => (
          <li
            key={`${item.reason}:${index}`}
            className="rcm-html-notice-item"
            data-testid="rcm-html-notice-item"
            data-reason={item.reason}
          >
            {item.text}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="rcm-html-notice-close"
        data-testid="rcm-html-notice-close"
        aria-label={labels.htmlNoticeClose}
        title={labels.htmlNoticeClose}
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}
