import { useEffect, useRef, useState } from 'react';
import './SubtitleBar.css';

export default function SubtitleBar({ text = '', autoHideDelay = 5000 }) {
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef(null);
  const normalizedText = typeof text === 'string' ? text.trim() : '';

  useEffect(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    if (normalizedText) {
      setVisible(true);
      hideTimerRef.current = setTimeout(() => {
        setVisible(false);
      }, autoHideDelay);
    } else {
      setVisible(false);
    }

    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [normalizedText, autoHideDelay]);

  return (
    <div className={`subtitle-container ${visible ? 'visible' : 'hidden'}`}>
      <span className="subtitle-text">{normalizedText}</span>
    </div>
  );
}
