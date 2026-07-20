import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import {
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
} from "./composerInlineChip";

type Props = {
  icon?: typeof Cancel01Icon;
  iconNode?: ReactNode;
  title?: string;
  onRemove: () => void;
  removeLabel?: string;
  children: ReactNode;
};

/** One chip in a composer's chip TRAY (below the input), styled with t3's ported
 *  inline-chip classes — see composerInlineChip.ts for provenance. */
export function ComposerTrayChip({
  icon,
  iconNode,
  title,
  onRemove,
  removeLabel = "Remove",
  children,
}: Props) {
  return (
    <span className={COMPOSER_INLINE_CHIP_CLASS_NAME} title={title}>
      {iconNode ??
        (icon && (
          <HugeiconsIcon
            icon={icon}
            size={13}
            strokeWidth={1.75}
            className={COMPOSER_INLINE_CHIP_ICON_CLASS_NAME}
          />
        ))}
      <span className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}>{children}</span>
      <button
        type="button"
        onClick={onRemove}
        title={removeLabel}
        aria-label={removeLabel}
        className={COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME}
      >
        <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2} />
      </button>
    </span>
  );
}
