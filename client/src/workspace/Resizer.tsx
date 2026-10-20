import { useCallback, useEffect, useRef } from 'react';

type ResizerProps = {
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  onToggle?: () => void;
};

/**
 * The drag handle between the side panel and the editor. Pointer capture keeps
 * the drag alive when the cursor moves over the Monaco editor, which otherwise
 * swallows the events.
 */
export function Resizer({ width, min, max, onResize, onToggle }: ResizerProps) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(width);

  const stop = useCallback(() => {
    dragging.current = false;
    document.body.classList.remove('is-resizing');
  }, []);

  useEffect(() => stop, [stop]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    startX.current = event.clientX;
    startWidth.current = width;
    document.body.classList.add('is-resizing');
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return;
    const next = startWidth.current + (event.clientX - startX.current);
    onResize(Math.min(max, Math.max(min, next)));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowLeft') onResize(Math.max(min, width - 16));
    else if (event.key === 'ArrowRight') onResize(Math.min(max, width + 16));
    else if (event.key === 'Enter' && onToggle) onToggle();
    else return;

    event.preventDefault();
  };

  return (
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={onKeyDown}
      onDoubleClick={onToggle}
    />
  );
}
