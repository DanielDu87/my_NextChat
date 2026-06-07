import { IconButton } from "@/app/components/button";
import SDIcon from "@/app/icons/sd.svg";
import ReturnIcon from "@/app/icons/return.svg";
import HistoryIcon from "@/app/icons/history.svg";
import Locale from "@/app/locales";
import styles from "./sd.module.scss";

import { Path } from "@/app/constant";

import { useNavigate } from "react-router-dom";
import dynamic from "next/dynamic";
import {
  SideBarContainer,
  SideBarBody,
  SideBarHeader,
  SideBarTail,
  useFixedSideBar,
  useHotKey,
} from "@/app/components/sidebar";

import { getParams, getModelParamBasicData } from "./sd-panel";
import { useSdStore } from "@/app/store/sd";
import { showToast } from "@/app/components/ui-lib";
import { useMobileScreen } from "@/app/utils";

const SdPanel = dynamic(
  async () => (await import("@/app/components/sd")).SdPanel,
  {
    loading: () => null,
  },
);

export function SideBar(props: { className?: string }) {
  useHotKey();
  const isMobileScreen = useMobileScreen();
  useFixedSideBar();
  const navigate = useNavigate();
  const sdStore = useSdStore();
  const currentModel = sdStore.currentModel;
  const params = sdStore.currentParams;
  const setParams = sdStore.setCurrentParams;

  const handleSubmit = () => {
    const columns = getParams?.(currentModel, params);
    const reqParams: any = {};
    for (let i = 0; i < columns.length; i++) {
      const item = columns[i];
      reqParams[item.value] = params[item.value] ?? null;
      if (item.required) {
        if (!reqParams[item.value]) {
          showToast(Locale.SdPanel.ParamIsRequired(item.name));
          return;
        }
      }
    }
    let data: any = {
      model: currentModel.value,
      model_name: currentModel.name,
      status: "wait",
      params: reqParams,
      created_at: new Date().toLocaleString(),
      img_data: "",
    };
    sdStore.sendTask(data, () => {
      setParams(getModelParamBasicData(columns, params, true));
      navigate(Path.SdNew);
    });
  };

  return (
    <SideBarContainer {...props}>
      {isMobileScreen ? (
        <div
          className="window-header"
          style={{
            paddingLeft: 0,
            paddingRight: 0,
          }}
        >
          <div className="window-actions">
            <div className="window-action-button">
              <IconButton
                icon={<ReturnIcon />}
                bordered
                title={Locale.Sd.Actions.ReturnHome}
                onClick={() => navigate(Path.Home)}
              />
            </div>
          </div>
          <div data-tauri-drag-region>
            <SDIcon width={50} height={50} />
          </div>
          <div className="window-actions">
            <div className="window-action-button">
              <IconButton
                icon={<HistoryIcon />}
                bordered
                title={Locale.Sd.Actions.History}
                onClick={() => navigate(Path.SdNew)}
              />
            </div>
          </div>
        </div>
      ) : (
        <SideBarHeader
          title={
            <IconButton
              icon={<ReturnIcon />}
              bordered
              title={Locale.Sd.Actions.ReturnHome}
              onClick={() => navigate(Path.Home)}
            />
          }
          logo={<SDIcon width={38} height={"100%"} />}
        ></SideBarHeader>
      )}
      <SideBarBody>
        <div className={styles["sd-panel-scroll"]}>
          <SdPanel />
        </div>
      </SideBarBody>
      <SideBarTail
        secondaryAction={
          <IconButton
            text={Locale.SdPanel.Submit}
            type="primary"
            shadow
            className={styles["sd-submit-button"]}
            onClick={handleSubmit}
          ></IconButton>
        }
      />
    </SideBarContainer>
  );
}
