import { useEffect, useState } from 'react';
import { AIService } from '../services/aiService';

export default function AttachmentImage({attachment}) {
  const [image, setImage] = useState(attachment.imageData);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (attachment.imageData) return;
    const controller = new AbortController();
    AIService.getFileImage(attachment.id,controller.signal).then(setImage).catch(error => {
      if (error.name !== 'AbortError') setFailed(true);
    });
    return () => controller.abort();
  },[attachment.id,attachment.imageData]);
  if (failed) return <span>Image unavailable. Please attach it again.</span>;
  return image ? <img className="message-attachment-image" src={image} alt={attachment.fileName} loading="lazy" /> : <span role="status">Loading image…</span>;
}
