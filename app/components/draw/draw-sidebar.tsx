import React, { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { IconButton } from "@/app/components/button";
import ReturnIcon from "@/app/icons/return.svg";
import AutoThemeIcon from "@/app/icons/auto.svg";
import LightThemeIcon from "@/app/icons/light.svg";
import DarkThemeIcon from "@/app/icons/dark.svg";
import HistoryIcon from "@/app/icons/history.svg";
import LogoIcon from "@/app/icons/logo.svg";
import Locale from "@/app/locales";
import styles from "./draw.module.scss";

import { Path } from "@/app/constant";

import { useNavigate } from "react-router-dom";
import dynamic from "next/dynamic";
import { useMobileScreen } from "@/app/utils";
import {
  SideBarContainer,
  SideBarBody,
  SideBarHeader,
  SideBarTail,
  useFixedSideBar,
  useHotKey,
} from "@/app/components/sidebar";

import { getParams, getModelParamBasicData } from "./draw-panel";
import { useDrawStore } from "@/app/store/draw";
import { useAccessStore } from "@/app/store";
import { showToast, showTopNotice } from "@/app/components/ui-lib";
import {
  isDrawParamSupported,
  pickSupportedDrawParams,
  sanitizeDrawParams,
} from "@/app/utils/draw-model-params";
import { DRAW_THEME_LABELS, type DrawTheme } from "./draw";

const DrawPanel = dynamic(
  async () => (await import("./draw-panel")).DrawPanel,
  {
    loading: () => null,
  },
);

const DRAW_THEME_OPTIONS: { value: DrawTheme; Icon: React.FC<any> }[] = [
  { value: "dark", Icon: DarkThemeIcon },
  { value: "light", Icon: LightThemeIcon },
  { value: "auto", Icon: AutoThemeIcon },
];

export function SideBar(props: {
  className?: string;
  drawTheme: DrawTheme;
  onSelectDrawTheme: (theme: DrawTheme) => void;
}) {
  const isMobileScreen = useMobileScreen();
  const submitGuardRef = useRef<{ fingerprint: string; at: number } | null>(
    null,
  );
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const themeMenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentThemeOption =
    DRAW_THEME_OPTIONS.find((item) => item.value === props.drawTheme) ||
    DRAW_THEME_OPTIONS[0];
  const showThemeMenuOnDesktopHover = () => {
    if (!isMobileScreen) {
      if (themeMenuTimerRef.current) {
        clearTimeout(themeMenuTimerRef.current);
        themeMenuTimerRef.current = null;
      }
      setThemeMenuOpen(true);
    }
  };
  const hideThemeMenuOnDesktopHover = () => {
    if (!isMobileScreen) {
      themeMenuTimerRef.current = setTimeout(() => {
        setThemeMenuOpen(false);
        themeMenuTimerRef.current = null;
      }, 300);
    }
  };

  useEffect(() => {
    return () => {
      if (themeMenuTimerRef.current) {
        clearTimeout(themeMenuTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!themeMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        themeMenuRef.current &&
        !themeMenuRef.current.contains(event.target as Node)
      ) {
        setThemeMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [themeMenuOpen]);
  useHotKey();
  useFixedSideBar();
  const navigate = useNavigate();
  const drawStore = useDrawStore();
  const accessStore = useAccessStore();
  const currentModel = drawStore.currentModel;
  const params = drawStore.currentParams;
  const setParams = drawStore.setCurrentParams;
  const selectedProviderType = String(
    (accessStore.apiProfiles || []).find(
      (item) => String(item?.id || "").trim() === drawStore.selectedProvider,
    )?.provider || "",
  );

  const handleSubmit = () => {
    const columns = getParams?.(currentModel, params);
    const reqParams = pickSupportedDrawParams(
      currentModel.value,
      params,
      selectedProviderType,
    );
    for (let i = 0; i < columns.length; i++) {
      const item = columns[i];
      if (
        !isDrawParamSupported(
          currentModel.value,
          item.value,
          selectedProviderType,
        )
      ) {
        continue;
      }
      if (item.required) {
        if (!reqParams[item.value]) {
          showToast(Locale.DrawPanel.ParamIsRequired(item.name));
          return;
        }
      }
    }
    const fingerprint = JSON.stringify({
      model: currentModel.value,
      provider: drawStore.selectedProvider,
      params: reqParams,
    });
    const now = Date.now();
    const lastSubmit = submitGuardRef.current;
    if (
      lastSubmit &&
      lastSubmit.fingerprint === fingerprint &&
      now - lastSubmit.at < 1000
    ) {
      showTopNotice("请求已提交，避免重复生成");
      return;
    }
    submitGuardRef.current = { fingerprint, at: now };
    let data: any = {
      model: currentModel.value,
      model_name: currentModel.name,
      status: "wait",
      params: reqParams,
      created_at: new Date().toLocaleString(),
      img_data: "",
    };
    drawStore.sendTask(data, () => {
      setParams(
        sanitizeDrawParams(
          currentModel.value,
          getModelParamBasicData(columns, params, true),
          selectedProviderType,
        ),
      );
      navigate(Path.DrawHistory);
    });
  };

  const handleReturnHome = () => {
    console.clear();

    navigate(Path.Home, {
      state: {
        suppressModelToast: true,
      },
    });
  };

  return (
    <SideBarContainer className={props.className}>
      <SideBarHeader
        title="AI 绘画"
        subTitle={
          isMobileScreen ? "让AI画出想象" : "让AI画出想象，让我陪你看见浪漫。"
        }
        logo={<LogoIcon width={35.05} height={38} />}
      >
        <div className={styles["draw-sidebar-actions"]}>
          <IconButton
            icon={<ReturnIcon />}
            text={Locale.Draw.Actions.ReturnHome}
            onClick={() => void handleReturnHome()}
          />
          <div
            className={styles["draw-theme-picker"]}
            ref={themeMenuRef}
            onMouseEnter={showThemeMenuOnDesktopHover}
            onMouseLeave={hideThemeMenuOnDesktopHover}
          >
            <IconButton
              icon={<currentThemeOption.Icon />}
              text="主题切换"
              onClick={() => {
                setThemeMenuOpen((value) => (isMobileScreen ? !value : true));
              }}
            />
            {themeMenuOpen && (
              <div
                className={styles["draw-theme-menu"]}
                role="menu"
                onMouseEnter={showThemeMenuOnDesktopHover}
                onMouseLeave={hideThemeMenuOnDesktopHover}
              >
                {DRAW_THEME_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className={clsx(styles["draw-theme-option"], {
                      [styles["draw-theme-option-active"]]:
                        option.value === props.drawTheme,
                    })}
                    onClick={() => {
                      props.onSelectDrawTheme(option.value);
                      setThemeMenuOpen(false);
                    }}
                  >
                    <option.Icon />
                    <span>{DRAW_THEME_LABELS[option.value]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {isMobileScreen && (
            <IconButton
              icon={<HistoryIcon />}
              text="生成记录"
              onClick={() => navigate(Path.DrawHistory)}
            />
          )}
        </div>
      </SideBarHeader>
      <SideBarBody>
        <div className={styles["draw-panel-scroll"]}>
          <DrawPanel />
        </div>
      </SideBarBody>
      <SideBarTail
        secondaryAction={
          <IconButton
            text={Locale.DrawPanel.Submit}
            type="primary"
            className={styles["draw-submit-button"]}
            onClick={handleSubmit}
          ></IconButton>
        }
      />
    </SideBarContainer>
  );
}
