import { LoaderCircle, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useApp, useRuntime, useT } from '../../app/runtime';
import { searchPlaces, type PlaceResult } from '../../lib/services/geocode';
import { cx } from '../controls';

type Phase = 'idle' | 'loading' | 'done' | 'error';

export function SearchBox() {
  const t = useT();
  const { store, actions } = useRuntime();
  const lang = useApp((s) => s.lang);
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const skipNext = useRef(false);

  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setPhase('idle');
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setPhase('loading');
      searchPlaces(q, { bias: store.get().view?.center, lang, signal: controller.signal }).then(
        (found) => {
          setResults(found);
          setActive(found.length > 0 ? 0 : -1);
          setPhase('done');
        },
        () => {
          if (controller.signal.aborted) return;
          setResults([]);
          setPhase('error');
        },
      );
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, lang, store]);

  const choose = (place: PlaceResult) => {
    skipNext.current = true;
    setQuery(place.name);
    setOpen(false);
    setResults([]);
    setPhase('idle');
    const box = place.bbox && place.bbox[0] !== place.bbox[2] ? place.bbox : undefined;
    actions.flyTo([place.lon, place.lat], 15, box);
  };

  const showList = open && query.trim().length >= 3 && phase !== 'idle';

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = results.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      if (n) setActive((a) => (a + 1) % n);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (n) setActive((a) => (a <= 0 ? n - 1 : a - 1));
    } else if (e.key === 'Enter') {
      if (showList && active >= 0 && results[active]) {
        e.preventDefault();
        choose(results[active]);
      }
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      if (showList) setOpen(false);
      else setQuery('');
    }
  };

  return (
    <div className="search">
      <Search className="search__icon" size={15} strokeWidth={1.75} aria-hidden="true" />
      <input
        id={id}
        className="input search__input"
        type="search"
        role="combobox"
        aria-label={t('searchLabel')}
        placeholder={t('searchPlaceholder')}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        value={query}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {phase === 'loading' ? <LoaderCircle className="search__spinner spin" size={14} aria-hidden="true" /> : null}
      <div className="search__popover" hidden={!showList}>
        {phase === 'loading' && results.length === 0 ? <p className="search__meta">{t('searching')}</p> : null}
        {phase === 'error' ? <p className="search__meta search__meta--error">{t('searchFailed')}</p> : null}
        {phase === 'done' && results.length === 0 ? <p className="search__meta">{t('searchEmpty')}</p> : null}
        <ul id={listId} role="listbox" aria-label={t('searchLabel')} className="search__list">
          {results.map((place, i) => (
            <li
              key={place.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={cx('search__option', i === active && 'is-active')}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(place)}
            >
              <span className="search__name">{place.name}</span>
              {place.detail ? <span className="search__detail">{place.detail}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
