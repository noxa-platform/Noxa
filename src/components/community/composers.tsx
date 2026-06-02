'use client';

/**
 * 投稿系コンポーネント: スレッド作成 / 返信 / NG ダイアログ（2 段階）。
 *  - hard ヒット: ブロック（投稿不可、修正のみ）
 *  - soft のみ: 警告（修正 or このまま投稿で続行可＝本人責任）
 */

import { useState } from 'react';
import { FONT, WINE, WINE_INK } from '@/lib/community/constants';
import { checkNg } from '@/lib/community/ng-words';
import type { AreaTag, JobTag } from '@/lib/community/types';
import { SectionLabel, TagPickers, cardBox, inputStyle, primaryBtn } from './ui';

const { mono, jp: fontJp } = FONT;

const MAX_LEN = 1000;

type NgState = { mode: 'block' | 'warn'; words: string[] } | null;

export function ThreadComposer({
  onSubmit,
}: {
  onSubmit: (title: string, body: string, area?: AreaTag, job?: JobTag) => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [area, setArea] = useState<AreaTag | undefined>();
  const [job, setJob] = useState<JobTag | undefined>();
  const [ng, setNg] = useState<NgState>(null);

  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && body.length <= MAX_LEN;

  const submit = () => onSubmit(title.trim(), body.trim(), area, job);
  const trySubmit = () => {
    if (!canSubmit) return;
    const { hard, soft } = checkNg(`${title} ${body}`);
    if (hard.length > 0) { setNg({ mode: 'block', words: hard }); return; }
    if (soft.length > 0) { setNg({ mode: 'warn', words: soft }); return; }
    submit();
  };

  return (
    <div style={cardBox()}>
      <SectionLabel>スレッドを立てる</SectionLabel>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="スレッドタイトル" aria-label="スレッドタイトル" style={inputStyle()} />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="本文（テキストのみ・最大1000字。源氏名・店名・連絡先・画像は不可）" aria-label="本文" style={{ ...inputStyle(), resize: 'none', marginTop: 10 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
        <TagPickers area={area} job={job} onArea={setArea} onJob={setJob} />
        <span style={{ fontFamily: mono, fontSize: 11, color: body.length > MAX_LEN ? WINE : 'var(--noxa-text-faint)' }}>{body.length}/{MAX_LEN}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <button type="button" onClick={trySubmit} disabled={!canSubmit} style={primaryBtn(canSubmit)}>立てる</button>
      </div>
      {ng && <NgDialog mode={ng.mode} words={ng.words} onCancel={() => setNg(null)} onProceed={() => { setNg(null); submit(); }} />}
    </div>
  );
}

export function ReplyComposer({
  onSubmit,
}: {
  onSubmit: (body: string, area?: AreaTag, job?: JobTag) => void;
}) {
  const [body, setBody] = useState('');
  const [area, setArea] = useState<AreaTag | undefined>();
  const [job, setJob] = useState<JobTag | undefined>();
  const [ng, setNg] = useState<NgState>(null);

  const canSubmit = body.trim().length > 0 && body.length <= MAX_LEN;

  const submit = () => {
    onSubmit(body.trim(), area, job);
    setBody(''); setArea(undefined); setJob(undefined);
  };
  const trySubmit = () => {
    if (!canSubmit) return;
    const { hard, soft } = checkNg(body);
    if (hard.length > 0) { setNg({ mode: 'block', words: hard }); return; }
    if (soft.length > 0) { setNg({ mode: 'warn', words: soft }); return; }
    submit();
  };

  return (
    <div style={{ ...cardBox(), marginTop: 14 }}>
      <SectionLabel>返信する</SectionLabel>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="このスレッドに返信（名無しさんで投稿されます）" aria-label="返信本文" style={{ ...inputStyle(), resize: 'none' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
        <TagPickers area={area} job={job} onArea={setArea} onJob={setJob} />
        <button type="button" onClick={trySubmit} disabled={!canSubmit} style={primaryBtn(canSubmit)}>返信</button>
      </div>
      {ng && <NgDialog mode={ng.mode} words={ng.words} onCancel={() => setNg(null)} onProceed={() => { setNg(null); submit(); }} />}
    </div>
  );
}

function NgDialog({
  mode, words, onCancel, onProceed,
}: {
  mode: 'block' | 'warn';
  words: string[];
  onCancel: () => void;
  onProceed: () => void;
}) {
  const isBlock = mode === 'block';
  return (
    <div role="alertdialog" aria-label={isBlock ? '投稿できません' : '規約違反の可能性'} style={{ position: 'fixed', inset: 0, background: 'rgba(7,5,13,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--noxa-surface-card)', border: `1px solid ${WINE}66`, borderRadius: 14, padding: 20, maxWidth: 400, width: '100%' }}>
        <div style={{ fontFamily: fontJp, fontSize: 15, fontWeight: 700, color: 'var(--noxa-text-primary)', marginBottom: 10 }}>
          {isBlock ? 'この内容は投稿できません' : 'この投稿は規約違反の可能性があります'}
        </div>
        <p style={{ fontFamily: fontJp, fontSize: 13, lineHeight: 1.7, color: 'var(--noxa-text-muted)', margin: '0 0 8px' }}>
          {isBlock
            ? '違法行為・連絡先交換（URL／メール／電話／LINE 等）は禁止されています。該当箇所を削除してください。'
            : '改正風営法の NG 表現等が含まれています。投稿の責任はご自身にあります。'}
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {words.map((w) => <span key={w} style={{ fontFamily: mono, fontSize: 11, color: WINE_INK, background: `${WINE}1A`, border: `1px solid ${WINE}44`, borderRadius: 6, padding: '2px 8px' }}>{w}</span>)}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} style={{ ...primaryBtn(false), cursor: 'pointer', background: isBlock ? 'var(--noxa-accent-primary)' : 'var(--noxa-surface-hover)', color: isBlock ? '#fff' : 'var(--noxa-text-muted)', border: isBlock ? '1px solid var(--noxa-accent-primary)' : '1px solid var(--noxa-border)' }}>修正する</button>
          {!isBlock && (
            <button type="button" onClick={onProceed} style={{ ...primaryBtn(true), background: WINE, border: `1px solid ${WINE}` }}>このまま投稿</button>
          )}
        </div>
      </div>
    </div>
  );
}
