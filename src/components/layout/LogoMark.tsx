// علامة محسن تيوب: مربع نبيتي هادي بحواف ناعمة، خيط دهبي رفيع، وزرار تشغيل دهبي في النص.
// ألوان مسطحة من غير تدرجات، عشان تفضل هادية وواضحة في أي مقاس.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <rect x="2" y="2" width="44" height="44" rx="13" fill="#4f0c1f" />
      <rect x="4.5" y="4.5" width="39" height="39" rx="10.5" fill="none" stroke="#d6b062" strokeOpacity=".35" strokeWidth=".8" />
      <path d="M19.5 17.6v12.8c0 1 1.1 1.6 1.9 1.1l10-6.4c.8-.5.8-1.7 0-2.2l-10-6.4c-.8-.5-1.9.1-1.9 1.1z" fill="#d6b062" />
    </svg>
  );
}
