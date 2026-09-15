import { useId, useState } from "react";
import { placementLabels } from "./placement";
import type { AttentionLevel } from "./types";

export const AttentionChooser = ({ onSelect, onClose, initialRepeatDaily = false, initialPurpose = "", purposes = [] }: {
  onSelect: (level: AttentionLevel, repeatDaily?: boolean, purpose?: string) => Promise<boolean>;
  onClose: () => void;
  initialRepeatDaily?: boolean;
  initialPurpose?: string;
  purposes?: string[];
}) => {
  const id = useId();
  const [purposeVisible, setPurposeVisible] = useState(false);
  const [purpose, setPurpose] = useState(initialPurpose);
  const [repeat, setRepeat] = useState(initialRepeatDaily);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const save = async (level: AttentionLevel) => {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const ok = await onSelect(level, level === "do_later" && repeat, level === "keep_for_use" ? purpose.trim() : undefined);
      if (ok) onClose(); else setError(true);
    } catch { setError(true); }
    finally { setBusy(false); }
  };
  return <section className="reminder-chooser attention-chooser">
    <div><strong>この言葉を、どこに置いておく？</strong><button type="button" disabled={busy} aria-label="置き場所の選択を閉じる" onClick={onClose}>×</button></div>
    <p>大切さの順位ではなく、今の自分に合う置き場所を選びます。</p>
    <fieldset disabled={busy} className="placement-fields">
      {purposeVisible ? <>
        <label htmlFor={id}>何に使うために取っておく？</label>
        <input id={id} list={id + "-purposes"} value={purpose} maxLength={100} onChange={e => setPurpose(e.target.value)} placeholder="例：旅行の計画" />
        <datalist id={id + "-purposes"}>{purposes.map(p => <option key={p} value={p} />)}</datalist>
        <button type="button" className="primary-button" disabled={!purpose.trim() || purpose.trim().length > 100} onClick={() => void save("keep_for_use")}>この使い道で取っておく</button>
        <button type="button" className="text-button" onClick={() => setPurposeVisible(false)}>置き場所の選択に戻る</button>
      </> : <>
        <label className="repeat-daily-option"><input type="checkbox" checked={repeat} onChange={e => setRepeat(e.target.checked)} /> だいたい毎日（あとでやる）</label>
        <div className="attention-options">
          {(Object.keys(placementLabels) as AttentionLevel[]).map(level =>
            <button type="button" key={level} onClick={() => level === "keep_for_use" ? setPurposeVisible(true) : void save(level)}>
              <strong>{level === "keep_for_use" ? "〇〇に使うから取っておく" : placementLabels[level]}</strong>
              {level === "keep_in_mind" && <small>ホワイトボードのように、今、目に入るところへ</small>}
            </button>
          )}
        </div>
      </>}
    </fieldset>
    {error && <p role="alert">保存できませんでした。入力は残っています。もう一度お試しください。</p>}
  </section>;
};
