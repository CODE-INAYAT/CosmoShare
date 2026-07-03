import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { gsap } from 'gsap';
import { useTheme } from 'next-themes';
import { Sun, Moon } from 'lucide-react';

export interface StaggeredMenuItem {
  label: string;
  ariaLabel: string;
  link: string;
}

export interface StaggeredMenuSocialItem {
  label: string;
  link: string;
}

export interface StaggeredMenuProps {
  position?: 'left' | 'right';
  colors?: string[];
  items?: StaggeredMenuItem[];
  socialItems?: StaggeredMenuSocialItem[];
  displaySocials?: boolean;
  displayItemNumbering?: boolean;
  className?: string;
  logoUrl?: string;
  menuButtonColor?: string;
  openMenuButtonColor?: string;
  accentColor?: string;
  isFixed: boolean;
  changeMenuColorOnOpen?: boolean;
  closeOnClickAway?: boolean;
  onMenuOpen?: () => void;
  onMenuClose?: () => void;
  onItemClick?: (item: StaggeredMenuItem, event: React.MouseEvent<HTMLAnchorElement>) => void;
}

export const StaggeredMenu: React.FC<StaggeredMenuProps> = ({
  position = 'right',
  colors = ['#B497CF', '#5227FF'],
  items = [],
  socialItems = [],
  displaySocials = true,
  displayItemNumbering = true,
  className,
  logoUrl = '/logo.svg',
  menuButtonColor = '#000',
  openMenuButtonColor = '#000',
  changeMenuColorOnOpen = true,
  accentColor = '#14b8a6',
  isFixed = false,
  closeOnClickAway = true,
  onMenuOpen,
  onMenuClose,
  onItemClick
}: StaggeredMenuProps) => {
  const { setTheme, resolvedTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const preLayersRef = useRef<HTMLDivElement | null>(null);
  const preLayerElsRef = useRef<HTMLElement[]>([]);

  const plusHRef = useRef<HTMLSpanElement | null>(null);
  const plusVRef = useRef<HTMLSpanElement | null>(null);
  const iconRef = useRef<HTMLSpanElement | null>(null);

  const textInnerRef = useRef<HTMLSpanElement | null>(null);
  const textWrapRef = useRef<HTMLSpanElement | null>(null);
  const [textLines, setTextLines] = useState<string[]>(['Menu', 'Close']);

  const openTlRef = useRef<gsap.core.Timeline | null>(null);
  const closeTweenRef = useRef<gsap.core.Tween | null>(null);
  const spinTweenRef = useRef<gsap.core.Timeline | null>(null);
  const textCycleAnimRef = useRef<gsap.core.Tween | null>(null);
  const colorTweenRef = useRef<gsap.core.Tween | null>(null);

  const toggleBtnRef = useRef<HTMLButtonElement | null>(null);
  const busyRef = useRef(false);

  const itemEntranceTweenRef = useRef<gsap.core.Tween | null>(null);

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const panel = panelRef.current;
      const preContainer = preLayersRef.current;

      const plusH = plusHRef.current;
      const plusV = plusVRef.current;
      const icon = iconRef.current;
      const textInner = textInnerRef.current;

      if (!panel || !plusH || !plusV || !icon || !textInner) return;

      let preLayers: HTMLElement[] = [];
      if (preContainer) {
        preLayers = Array.from(preContainer.querySelectorAll('.sm-prelayer')) as HTMLElement[];
      }
      preLayerElsRef.current = preLayers;

      const offscreen = position === 'left' ? -100 : 100;
      if (!openRef.current) {
        gsap.set([panel, ...preLayers], { xPercent: offscreen, opacity: 1, force3D: true });
        if (preContainer) {
          gsap.set(preContainer, { xPercent: 0, opacity: 1, force3D: true });
        }
      }

      gsap.set(plusH, { transformOrigin: '50% 50%', rotate: 0 });
      gsap.set(plusV, { transformOrigin: '50% 50%', rotate: 90 });
      gsap.set(icon, { rotate: 0, transformOrigin: '50% 50%' });

      gsap.set(textInner, { yPercent: 0 });

      if (toggleBtnRef.current) {
        const targetColor = openRef.current ? openMenuButtonColor : menuButtonColor;
        gsap.set(toggleBtnRef.current, { color: targetColor });
      }
    });
    return () => ctx.revert();
  }, [menuButtonColor, openMenuButtonColor, position]);

  const buildOpenTimeline = useCallback(() => {
    const panel = panelRef.current;
    const layers = preLayerElsRef.current;
    if (!panel) return null;

    openTlRef.current?.kill();
    if (closeTweenRef.current) {
      closeTweenRef.current.kill();
      closeTweenRef.current = null;
    }
    itemEntranceTweenRef.current?.kill();

    const itemEls = Array.from(panel.querySelectorAll('.sm-panel-itemLabel')) as HTMLElement[];
    const numberEls = Array.from(
      panel.querySelectorAll('.sm-panel-list[data-numbering] .sm-panel-item')
    ) as HTMLElement[];
    const socialTitle = panel.querySelector('.sm-socials-title') as HTMLElement | null;
    const socialLinks = Array.from(panel.querySelectorAll('.sm-socials-link')) as HTMLElement[];

    const offscreen = position === 'left' ? -100 : 100;
    const layerStates = layers.map(el => ({ el, start: offscreen }));
    const panelStart = offscreen;

    if (itemEls.length) gsap.set(itemEls, { yPercent: 140, rotate: 10 });
    if (numberEls.length) gsap.set(numberEls, { ['--sm-num-opacity' as any]: 0 });
    if (socialTitle) gsap.set(socialTitle, { opacity: 0 });
    if (socialLinks.length) gsap.set(socialLinks, { y: 25, opacity: 0 });

    const tl = gsap.timeline({ paused: true });

    layerStates.forEach((ls, i) => {
      tl.fromTo(ls.el, { xPercent: ls.start }, { xPercent: 0, duration: 0.5, ease: 'power4.out', force3D: true }, i * 0.07);
    });

    const lastTime = layerStates.length ? (layerStates.length - 1) * 0.07 : 0;
    const panelInsertTime = lastTime + (layerStates.length ? 0.08 : 0);
    const panelDuration = 0.65;

    tl.fromTo(
      panel,
      { xPercent: panelStart },
      { xPercent: 0, duration: panelDuration, ease: 'power4.out', force3D: true },
      panelInsertTime
    );

    if (itemEls.length) {
      const itemsStartRatio = 0.15;
      const itemsStart = panelInsertTime + panelDuration * itemsStartRatio;

      tl.to(
        itemEls,
        { yPercent: 0, rotate: 0, duration: 1, ease: 'power4.out', stagger: { each: 0.1, from: 'start' } },
        itemsStart
      );

      if (numberEls.length) {
        tl.to(
          numberEls,
          { duration: 0.6, ease: 'power2.out', ['--sm-num-opacity' as any]: 1, stagger: { each: 0.08, from: 'start' } },
          itemsStart + 0.1
        );
      }
    }

    if (socialTitle || socialLinks.length) {
      const socialsStart = panelInsertTime + panelDuration * 0.4;

      if (socialTitle) tl.to(socialTitle, { opacity: 1, duration: 0.5, ease: 'power2.out' }, socialsStart);
      if (socialLinks.length) {
        tl.to(
          socialLinks,
          {
            y: 0,
            opacity: 1,
            duration: 0.55,
            ease: 'power3.out',
            stagger: { each: 0.08, from: 'start' },
            onComplete: () => {
              gsap.set(socialLinks, { clearProps: 'opacity' });
            }
          },
          socialsStart + 0.04
        );
      }
    }

    openTlRef.current = tl;
    return tl;
  }, [position]);

  const playOpen = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    const tl = buildOpenTimeline();
    if (tl) {
      tl.eventCallback('onComplete', () => {
        busyRef.current = false;
      });
      tl.play(0);
    } else {
      busyRef.current = false;
    }
  }, [buildOpenTimeline]);

  const playClose = useCallback(() => {
    openTlRef.current?.kill();
    openTlRef.current = null;
    itemEntranceTweenRef.current?.kill();

    const panel = panelRef.current;
    const layers = preLayerElsRef.current;
    if (!panel) return;

    const all: HTMLElement[] = [...layers, panel];
    closeTweenRef.current?.kill();

    const offscreen = position === 'left' ? -100 : 100;

    closeTweenRef.current = gsap.to(all, {
      xPercent: offscreen,
      duration: 0.32,
      ease: 'power3.in',
      overwrite: 'auto',
      force3D: true,
      onComplete: () => {
        const itemEls = Array.from(panel.querySelectorAll('.sm-panel-itemLabel')) as HTMLElement[];
        if (itemEls.length) gsap.set(itemEls, { yPercent: 140, rotate: 10 });

        const numberEls = Array.from(
          panel.querySelectorAll('.sm-panel-list[data-numbering] .sm-panel-item')
        ) as HTMLElement[];
        if (numberEls.length) gsap.set(numberEls, { ['--sm-num-opacity' as any]: 0 });

        const socialTitle = panel.querySelector('.sm-socials-title') as HTMLElement | null;
        const socialLinks = Array.from(panel.querySelectorAll('.sm-socials-link')) as HTMLElement[];
        if (socialTitle) gsap.set(socialTitle, { opacity: 0 });
        if (socialLinks.length) gsap.set(socialLinks, { y: 25, opacity: 0 });

        busyRef.current = false;
      }
    });
  }, [position]);

  const animateIcon = useCallback((opening: boolean) => {
    const icon = iconRef.current;
    const h = plusHRef.current;
    const v = plusVRef.current;
    if (!icon || !h || !v) return;

    spinTweenRef.current?.kill();

    if (opening) {
      gsap.set(icon, { rotate: 0, transformOrigin: '50% 50%' });
      spinTweenRef.current = gsap
        .timeline({ defaults: { ease: 'power4.out' } })
        .to(h, { rotate: 45, duration: 0.5 }, 0)
        .to(v, { rotate: -45, duration: 0.5 }, 0);
    } else {
      spinTweenRef.current = gsap
        .timeline({ defaults: { ease: 'power3.inOut' } })
        .to(h, { rotate: 0, duration: 0.35 }, 0)
        .to(v, { rotate: 90, duration: 0.35 }, 0)
        .to(icon, { rotate: 0, duration: 0.001 }, 0);
    }
  }, []);

  const animateColor = useCallback(
    (opening: boolean) => {
      const btn = toggleBtnRef.current;
      if (!btn) return;
      colorTweenRef.current?.kill();
      if (changeMenuColorOnOpen) {
        const targetColor = opening ? openMenuButtonColor : menuButtonColor;
        colorTweenRef.current = gsap.to(btn, { color: targetColor, delay: 0.18, duration: 0.3, ease: 'power2.out' });
      } else {
        gsap.set(btn, { color: menuButtonColor });
      }
    },
    [openMenuButtonColor, menuButtonColor, changeMenuColorOnOpen]
  );

  React.useEffect(() => {
    if (toggleBtnRef.current) {
      if (changeMenuColorOnOpen) {
        const targetColor = openRef.current ? openMenuButtonColor : menuButtonColor;
        gsap.set(toggleBtnRef.current, { color: targetColor });
      } else {
        gsap.set(toggleBtnRef.current, { color: menuButtonColor });
      }
    }
  }, [changeMenuColorOnOpen, menuButtonColor, openMenuButtonColor]);

  const animateText = useCallback((opening: boolean) => {
    const inner = textInnerRef.current;
    if (!inner) return;

    textCycleAnimRef.current?.kill();

    const currentLabel = opening ? 'Menu' : 'Close';
    const targetLabel = opening ? 'Close' : 'Menu';
    const cycles = 3;

    const seq: string[] = [currentLabel];
    let last = currentLabel;
    for (let i = 0; i < cycles; i++) {
      last = last === 'Menu' ? 'Close' : 'Menu';
      seq.push(last);
    }
    if (last !== targetLabel) seq.push(targetLabel);
    seq.push(targetLabel);

    setTextLines(seq);
    gsap.set(inner, { yPercent: 0 });

    const lineCount = seq.length;
    const finalShift = ((lineCount - 1) / lineCount) * 100;

    textCycleAnimRef.current = gsap.to(inner, {
      yPercent: -finalShift,
      duration: 0.5 + lineCount * 0.07,
      ease: 'power4.out'
    });
  }, []);

  const toggleMenu = useCallback(() => {
    const target = !openRef.current;
    openRef.current = target;
    setOpen(target);

    if (target) {
      onMenuOpen?.();
      playOpen();
    } else {
      onMenuClose?.();
      playClose();
    }

    animateIcon(target);
    animateColor(target);
    animateText(target);
  }, [playOpen, playClose, animateIcon, animateColor, animateText, onMenuOpen, onMenuClose]);

  const closeMenu = useCallback(() => {
    if (openRef.current) {
      openRef.current = false;
      setOpen(false);
      onMenuClose?.();
      playClose();
      animateIcon(false);
      animateColor(false);
      animateText(false);
    }
  }, [playClose, animateIcon, animateColor, animateText, onMenuClose]);

  React.useEffect(() => {
    if (!closeOnClickAway || !open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        toggleBtnRef.current &&
        !toggleBtnRef.current.contains(event.target as Node)
      ) {
        closeMenu();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [closeOnClickAway, open, closeMenu]);

  const triggerContainer = mounted && typeof window !== 'undefined' ? document.getElementById('mobile-menu-trigger') : null;

  return (
    <div
      className={`sm-scope z-40 ${open ? 'pointer-events-auto' : 'pointer-events-none'} ${isFixed ? 'fixed top-0 left-0 w-screen h-screen overflow-hidden' : 'w-full h-full'}`}
    >
      <div
        className={
          (className ? className + ' ' : '') + 'staggered-menu-wrapper pointer-events-none relative w-full h-full z-40'
        }
        style={accentColor ? ({ ['--sm-accent' as any]: accentColor } as React.CSSProperties) : undefined}
        data-position={position}
        data-open={open || undefined}
      >
        <div
          ref={preLayersRef}
          className="sm-prelayers absolute top-0 right-0 bottom-0 pointer-events-none z-[5]"
          aria-hidden="true"
        >
          {(() => {
            const raw = colors && colors.length ? colors.slice(0, 4) : ['#1e1e22', '#35353c'];
            let arr = [...raw];
            if (arr.length >= 3) {
              const mid = Math.floor(arr.length / 2);
              arr.splice(mid, 1);
            }
            return arr.map((c, i) => (
              <div
                key={i}
                className="sm-prelayer absolute top-0 right-0 h-full w-full translate-x-0"
                style={{ background: c }}
              />
            ));
          })()}
        </div>

        {triggerContainer ? (
          createPortal(
            <button
              ref={toggleBtnRef}
              className={`sm-toggle relative w-10 h-10 rounded-xl bg-secondary/80 hover:bg-secondary flex flex-col items-center justify-center transition-all duration-300 pointer-events-auto border border-border/10 focus:outline-none cursor-pointer ${
                open ? 'text-black dark:text-white' : 'text-foreground'
              }`}
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              aria-controls="staggered-menu-panel"
              onClick={toggleMenu}
              type="button"
            >
              {/* Animated Hamburger/X lines */}
              <div className={`absolute w-5 h-0.5 bg-current rounded-full transition-all duration-300 transform ${open ? 'rotate-45 translate-y-0' : '-translate-y-1.5'}`} />
              <div className={`absolute w-5 h-0.5 bg-current rounded-full transition-all duration-300 transform ${open ? 'opacity-0 scale-x-0' : 'opacity-100'}`} />
              <div className={`absolute w-5 h-0.5 bg-current rounded-full transition-all duration-300 transform ${open ? '-rotate-45 translate-y-0' : 'translate-y-1.5'}`} />

              {/* Hidden elements to satisfy GSAP refs */}
              <span ref={plusHRef} className="hidden" />
              <span ref={plusVRef} className="hidden" />
              <span ref={iconRef} className="hidden" />
              <span ref={textWrapRef} className="hidden">
                <span ref={textInnerRef} />
              </span>
            </button>,
            triggerContainer
          )
        ) : (
          <header
            className="staggered-menu-header absolute top-0 left-0 w-full flex items-center justify-between p-[1.5em] bg-transparent pointer-events-none z-20"
            aria-label="Main navigation header"
          >
            <div className="sm-logo flex items-center select-none pointer-events-auto" aria-label="Logo">
              <img
                src={logoUrl}
                alt="Logo"
                className="sm-logo-img block h-8 w-auto object-contain"
                draggable={false}
                width={110}
                height={24}
              />
            </div>

            <button
              ref={toggleBtnRef}
              className={`sm-toggle relative w-10 h-10 rounded-xl bg-secondary/80 hover:bg-secondary flex flex-col items-center justify-center transition-all duration-300 pointer-events-auto border border-border/10 focus:outline-none cursor-pointer ${
                open ? 'text-black dark:text-white' : 'text-foreground'
              }`}
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              aria-controls="staggered-menu-panel"
              onClick={toggleMenu}
              type="button"
            >
              {/* Animated Hamburger/X lines */}
              <div className={`absolute w-5 h-0.5 bg-current rounded-full transition-all duration-300 transform ${open ? 'rotate-45 translate-y-0' : '-translate-y-1.5'}`} />
              <div className={`absolute w-5 h-0.5 bg-current rounded-full transition-all duration-300 transform ${open ? 'opacity-0 scale-x-0' : 'opacity-100'}`} />
              <div className={`absolute w-5 h-0.5 bg-current rounded-full transition-all duration-300 transform ${open ? '-rotate-45 translate-y-0' : 'translate-y-1.5'}`} />

              {/* Hidden elements to satisfy GSAP refs */}
              <span ref={plusHRef} className="hidden" />
              <span ref={plusVRef} className="hidden" />
              <span ref={iconRef} className="hidden" />
              <span ref={textWrapRef} className="hidden">
                <span ref={textInnerRef} />
              </span>
            </button>
          </header>
        )}

        <aside
          id="staggered-menu-panel"
          ref={panelRef}
          className="staggered-menu-panel absolute top-0 right-0 h-full bg-white flex flex-col p-[6em_2em_2em_2em] overflow-y-auto z-10 backdrop-blur-[12px] pointer-events-auto"
          style={{ WebkitBackdropFilter: 'blur(12px)' }}
          aria-hidden={!open}
        >
          <div className="sm-panel-inner flex-1 flex flex-col gap-5">
            {/* Center-aligned tactile Segmented Theme Toggle Control */}
            <div className="flex justify-center mb-8 mt-2">
              <div className="relative flex items-center p-1 rounded-full bg-secondary/40 dark:bg-slate-900/60 border border-border/10 w-40 sm:w-48 h-11 sm:h-12 shadow-inner select-none transition-all duration-300">
                {/* Sliding indicator */}
                <div
                  className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-full bg-white dark:bg-slate-800 shadow-md transition-all duration-300 ease-out transform border border-slate-200/20 dark:border-slate-700/50 ${
                    resolvedTheme === 'dark' ? 'translate-x-[calc(100%+4px)]' : 'translate-x-0'
                  }`}
                />
                
                {/* Light mode select */}
                <button
                  type="button"
                  onClick={() => setTheme('light')}
                  className={`relative z-10 flex-1 flex items-center justify-center gap-2 h-full text-xs sm:text-sm font-semibold rounded-full cursor-pointer transition-colors duration-250 select-none ${
                    resolvedTheme !== 'dark' ? 'text-teal-600 dark:text-teal-400' : 'text-muted-foreground/70'
                  }`}
                >
                  <Sun className="w-4 h-4" />
                  <span>Light</span>
                </button>

                {/* Dark mode select */}
                <button
                  type="button"
                  onClick={() => setTheme('dark')}
                  className={`relative z-10 flex-1 flex items-center justify-center gap-2 h-full text-xs sm:text-sm font-semibold rounded-full cursor-pointer transition-colors duration-250 select-none ${
                    resolvedTheme === 'dark' ? 'text-teal-400' : 'text-muted-foreground/70'
                  }`}
                >
                  <Moon className="w-4 h-4" />
                  <span>Dark</span>
                </button>
              </div>
            </div>

            <ul
              className="sm-panel-list list-none m-0 p-0 flex flex-col items-center gap-6 sm:gap-8"
              role="list"
              data-numbering={displayItemNumbering || undefined}
            >
              {items && items.length ? (
                items.map((it, idx) => (
                  <li className="sm-panel-itemWrap relative overflow-hidden leading-none" key={it.label + idx}>
                    <a
                      className="sm-panel-item relative cursor-pointer leading-none uppercase transition-[background,color] duration-150 ease-linear flex items-center justify-center gap-4 no-underline text-black dark:text-white text-center w-full"
                      href={it.link}
                      aria-label={it.ariaLabel}
                      data-index={idx + 1}
                      onClick={(e) => {
                        if (onItemClick) {
                          onItemClick(it, e);
                        }
                        closeMenu();
                      }}
                    >
                      {displayItemNumbering && (
                        <span className="sm-panel-itemNum text-sm sm:text-base font-normal text-[color:var(--sm-accent,#14b8a6)] select-none">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                      )}
                      <span className="sm-panel-itemLabel font-bold text-[8vw] sm:text-[3rem] md:text-[3.5rem] tracking-tight transition-transform duration-300 ease-out will-change-transform">
                        {it.label}
                      </span>
                    </a>
                  </li>
                ))
              ) : (
                <li className="sm-panel-itemWrap relative overflow-hidden leading-none" aria-hidden="true">
                  <span className="sm-panel-item relative cursor-pointer leading-none uppercase transition-[background,color] duration-150 ease-linear flex items-center justify-center gap-4 no-underline text-black dark:text-white text-center w-full">
                    <span className="sm-panel-itemLabel font-bold text-[8vw] sm:text-[3rem] md:text-[3.5rem] tracking-tight transition-transform duration-300 ease-out will-change-transform">
                      No items
                    </span>
                  </span>
                </li>
              )}
            </ul>

            {displaySocials && socialItems && socialItems.length > 0 && (
              <div className="sm-socials mt-auto pt-8 flex flex-col gap-3" aria-label="Social links">
                <h3 className="sm-socials-title m-0 text-base font-medium [color:var(--sm-accent,#ff0000)]">Socials</h3>
                <ul
                  className="sm-socials-list list-none m-0 p-0 flex flex-row items-center gap-4 flex-wrap"
                  role="list"
                >
                  {socialItems.map((s, i) => (
                    <li key={s.label + i} className="sm-socials-item">
                      <a
                        href={s.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="sm-socials-link text-[1.2rem] font-medium text-[#111] no-underline relative inline-block py-[2px] transition-[color,opacity] duration-300 ease-linear"
                      >
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </aside>
      </div>

      <style>{`
.sm-scope .staggered-menu-wrapper { position: relative; width: 100%; height: 100%; z-index: 40; pointer-events: none; }
.sm-scope .staggered-menu-wrapper[data-open] { pointer-events: auto; }
.sm-scope .staggered-menu-header { position: absolute; top: 0; left: 0; width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 1.5em; background: transparent; pointer-events: none; z-index: 20; }
.sm-scope .staggered-menu-header > * { pointer-events: auto; }
.sm-scope .sm-logo { display: flex; align-items: center; user-select: none; }
.sm-scope .sm-logo-img { display: block; height: 32px; width: auto; object-fit: contain; }
.sm-scope .sm-toggle { position: relative; display: inline-flex; align-items: center; gap: 0.3rem; background: transparent; border: none; cursor: pointer; color: inherit; font-weight: 600; line-height: 1; overflow: visible; font-size: 1rem; }
.sm-scope .sm-toggle:focus-visible { outline: 2px solid #ffffffaa; outline-offset: 4px; border-radius: 4px; }
.sm-scope .sm-toggle-textWrap { position: relative; margin-right: 0.5em; display: inline-block; height: 1em; overflow: hidden; white-space: nowrap; width: var(--sm-toggle-width, auto); min-width: var(--sm-toggle-width, auto); }
.sm-scope .sm-toggle-textInner { display: flex; flex-direction: column; line-height: 1; }
.sm-scope .sm-toggle-line { display: block; height: 1em; line-height: 1; }
.sm-scope .sm-icon { position: relative; width: 14px; height: 14px; flex: 0 0 14px; display: inline-flex; align-items: center; justify-content: center; will-change: transform; }
.sm-scope .sm-panel-itemWrap { position: relative; overflow: hidden; line-height: 1; }
.sm-scope .sm-icon-line { position: absolute; left: 50%; top: 50%; width: 100%; height: 2px; background: currentColor; border-radius: 2px; transform: translate(-50%, -50%); will-change: transform; }
.sm-scope .sm-line { display: none !important; }
.sm-scope .staggered-menu-panel { position: absolute; top: 0; right: 0; width: clamp(260px, 38vw, 420px); height: 100%; background: white; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); display: flex; flex-direction: column; padding: 6em 2em 2em 2em; overflow-y: auto; z-index: 10; will-change: transform; }
.sm-scope [data-position='left'] .staggered-menu-panel { right: auto; left: 0; }
.sm-scope .sm-prelayers { position: absolute; top: 0; right: 0; bottom: 0; width: clamp(260px, 38vw, 420px); pointer-events: none; z-index: 5; }
.sm-scope [data-position='left'] .sm-prelayers { right: auto; left: 0; }
.sm-scope .sm-prelayer { position: absolute; top: 0; right: 0; height: 100%; width: 100%; transform: translateX(0); will-change: transform; }
.sm-scope .sm-panel-inner { flex: 1; display: flex; flex-direction: column; gap: 1.25rem; }
.sm-scope .sm-socials { margin-top: auto; padding-top: 2rem; display: flex; flex-direction: column; gap: 0.75rem; }
.sm-scope .sm-socials-title { margin: 0; font-size: 1rem; font-weight: 500; color: var(--sm-accent, #ff0000); }
.sm-scope .sm-socials-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: row; align-items: center; gap: 1rem; flex-wrap: wrap; }
.sm-scope .sm-socials-list .sm-socials-link { opacity: 1; transition: opacity 0.3s ease; }
.sm-scope .sm-socials-list:hover .sm-socials-link:not(:hover) { opacity: 0.35; }
.sm-scope .sm-socials-list:focus-within .sm-socials-link:not(:focus-visible) { opacity: 0.35; }
.sm-scope .sm-socials-list .sm-socials-link:hover,
.sm-scope .sm-socials-list .sm-socials-link:focus-visible { opacity: 1; }
.sm-scope .sm-socials-link:focus-visible { outline: 2px solid var(--sm-accent, #ff0000); outline-offset: 3px; }
.sm-scope .sm-socials-link { font-size: 1.2rem; font-weight: 500; color: #111; text-decoration: none; position: relative; padding: 2px 0; display: inline-block; transition: color 0.3s ease, opacity 0.3s ease; }
.sm-scope .sm-socials-link:hover { color: var(--sm-accent, #ff0000); }
.sm-scope .sm-panel-title { margin: 0; font-size: 1rem; font-weight: 600; color: #fff; text-transform: uppercase; }
.sm-scope .sm-panel-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; align-items: center; gap: 1.5rem; }
.sm-scope .sm-panel-item { position: relative; color: #000; font-weight: 600; cursor: pointer; line-height: 1; text-transform: uppercase; transition: background 0.25s, color 0.25s; display: flex; align-items: center; justify-content: center; gap: 1rem; text-decoration: none; text-align: center; width: 100%; }
.sm-scope .sm-panel-itemNum { font-size: 1rem; font-weight: 400; color: var(--sm-accent, #14b8a6); opacity: var(--sm-num-opacity, 0); user-select: none; pointer-events: none; font-family: monospace; transition: opacity 0.3s ease; }
.sm-scope .sm-panel-itemLabel { display: inline-block; will-change: transform; transform-origin: 50% 100%; }
.sm-scope .sm-panel-item:hover { color: var(--sm-accent, #ff0000); }

/* Dark mode overrides */
.dark .sm-scope .staggered-menu-panel {
  background: #020617;
  border-left: 1px solid rgba(255,255,255,0.06);
}
.dark .sm-scope .sm-panel-item {
  color: #fff;
}
.dark .sm-scope .sm-panel-item:hover {
  color: var(--sm-accent, #14b8a6);
}
.dark .sm-scope .sm-socials-link {
  color: #e2e8f0;
}
.dark .sm-scope .sm-socials-link:hover {
  color: var(--sm-accent, #14b8a6);
}

@media (max-width: 1024px) {
  .sm-scope .staggered-menu-panel {
    width: 100%;
    left: 0;
    right: 0;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    background: white;
  }
  .dark .sm-scope .staggered-menu-panel {
    background: #020617;
  }
  .sm-scope .sm-prelayers {
    width: 100%;
    left: 0;
    right: 0;
  }
}
@media (max-width: 640px) {
  .sm-scope .staggered-menu-panel {
    width: 100%;
    left: 0;
    right: 0;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    background: white;
  }
  .dark .sm-scope .staggered-menu-panel {
    background: #020617;
  }
  .sm-scope .sm-prelayers {
    width: 100%;
    left: 0;
    right: 0;
  }
}
      `}</style>
    </div>
  );
};

export default StaggeredMenu;
