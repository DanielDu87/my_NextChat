import { useDebouncedCallback } from "use-debounce";
import OpenAPIClientAxios from "openapi-client-axios";
import yaml from "js-yaml";
import { getPluginsRepoUrl } from "../constant";
import { IconButton } from "./button";
import { ErrorBoundary } from "./error";

import styles from "./mask.module.scss";
import pluginStyles from "./plugin.module.scss";

import EditIcon from "../icons/edit.svg";
import AddIcon from "../icons/add.svg";
import CloseIcon from "../icons/close.svg";
import DeleteIcon from "../icons/delete.svg";
import ConfirmIcon from "../icons/confirm.svg";
import ReloadIcon from "../icons/reload.svg";
import GithubIcon from "../icons/github.svg";
import PowerIcon from "../icons/power.svg";

import { Plugin, usePluginStore, FunctionToolService } from "../store/plugin";
import {
  PasswordInput,
  List,
  ListItem,
  Modal,
  showConfirm,
  showToast,
} from "./ui-lib";
import { NextChatBrandIcon, SideBarHeader } from "./sidebar";
import { DrawSelect } from "./draw/draw-panel";
import Locale from "../locales";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import clsx from "clsx";

function resolvePluginUrl(loadUrl: string) {
  const url = new URL(loadUrl);

  if (url.hostname === "raw.githubusercontent.com") {
    return `/api/github-raw${url.pathname}${url.search}`;
  }

  if (url.hostname === "api.github.com") {
    return `/api/github${url.pathname}${url.search}`;
  }

  if (url.hostname === "github.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 5 && parts[2] === "blob") {
      const [owner, repo, , branch, ...rest] = parts;
      return `/api/github-raw/${owner}/${repo}/${branch}/${rest.join("/")}${
        url.search
      }`;
    }
  }

  return loadUrl;
}

export function PluginPage() {
  const navigate = useNavigate();
  const pluginStore = usePluginStore();
  const pluginsRepoUrl = getPluginsRepoUrl();

  const allPlugins = pluginStore.getAll();
  const [searchPlugins, setSearchPlugins] = useState<Plugin[]>([]);
  const [searchText, setSearchText] = useState("");
  const plugins = searchText.length > 0 ? searchPlugins : allPlugins;

  // refactored already, now it accurate
  const onSearch = (text: string) => {
    setSearchText(text);
    if (text.length > 0) {
      const result = allPlugins.filter(
        (m) => m?.title.toLowerCase().includes(text.toLowerCase()),
      );
      setSearchPlugins(result);
    } else {
      setSearchPlugins(allPlugins);
    }
  };

  const [editingPluginId, setEditingPluginId] = useState<string | undefined>();
  const editingPlugin = pluginStore.get(editingPluginId);
  const editingPluginTool = FunctionToolService.get(editingPlugin?.id);
  const closePluginModal = () => setEditingPluginId(undefined);

  const onChangePlugin = useDebouncedCallback((editingPlugin, e) => {
    const content = e.target.innerText;
    try {
      const api = new OpenAPIClientAxios({
        definition: yaml.load(content) as any,
      });
      api
        .init()
        .then(() => {
          if (content != editingPlugin.content) {
            pluginStore.updatePlugin(editingPlugin.id, (plugin) => {
              plugin.content = content;
              const tool = FunctionToolService.add(plugin, true);
              plugin.title = tool.api.definition.info.title;
              plugin.version = tool.api.definition.info.version;
            });
          }
        })
        .catch((e) => {
          console.error(e);
          showToast(Locale.Plugin.EditModal.Error);
        });
    } catch (e) {
      console.error(e);
      showToast(Locale.Plugin.EditModal.Error);
    }
  }, 100).bind(null, editingPlugin);

  const [loadUrl, setLoadUrl] = useState<string>("");
  const loadFromUrl = (loadUrl: string) =>
    fetch(resolvePluginUrl(loadUrl))
      .catch((e) => {
        const p = new URL(loadUrl);
        return fetch(`/api/proxy/${p.pathname}?${p.search}`, {
          headers: {
            "X-Base-URL": p.origin,
          },
        });
      })
      .then((res) => res.text())
      .then((content) => {
        try {
          return JSON.stringify(JSON.parse(content), null, "  ");
        } catch (e) {
          return content;
        }
      })
      .then((content) => {
        pluginStore.updatePlugin(editingPlugin.id, (plugin) => {
          plugin.content = content;
          const tool = FunctionToolService.add(plugin, true);
          plugin.title = tool.api.definition.info.title;
          plugin.version = tool.api.definition.info.version;
        });
      })
      .catch((e) => {
        showToast(Locale.Plugin.EditModal.Error);
      });

  return (
    <ErrorBoundary>
      <div className={clsx(styles["mask-page"], pluginStyles["plugin-page"])}>
        <div className={pluginStyles["plugin-mobile-header"]}>
          <SideBarHeader
            title={Locale.Plugin.Page.Title}
            subTitle={Locale.Plugin.Page.SubTitle(plugins.length)}
            logo={<NextChatBrandIcon />}
          />

          <div className={pluginStyles["plugin-mobile-header-actions"]}>
            <a href={pluginsRepoUrl} target="_blank" rel="noopener noreferrer">
              <IconButton icon={<GithubIcon />} />
            </a>
            <IconButton
              aria={Locale.UI.Close}
              icon={<CloseIcon />}
              close
              onClick={() => navigate(-1)}
            />
          </div>
        </div>

        <div className="window-header">
          <div className="window-header-title">
            <div className="window-header-main-title">
              {Locale.Plugin.Page.Title}
            </div>
            <div className="window-header-submai-title">
              {Locale.Plugin.Page.SubTitle(plugins.length)}
            </div>
          </div>

          <div className="window-actions">
            <div className="window-action-button">
              <a
                href={pluginsRepoUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <IconButton icon={<GithubIcon />} />
              </a>
            </div>
            <div className="window-action-button">
              <IconButton
                aria={Locale.UI.Close}
                icon={<CloseIcon />}
                close
                onClick={() => navigate(-1)}
              />
            </div>
          </div>
        </div>

        <div
          className={clsx(
            styles["mask-page-body"],
            pluginStyles["plugin-page-body"],
          )}
        >
          <div
            className={clsx(
              styles["mask-filter"],
              pluginStyles["plugin-filter"],
            )}
          >
            <input
              type="text"
              className={clsx(
                styles["search-bar"],
                pluginStyles["plugin-search-bar"],
                "nextchat-input-control",
              )}
              placeholder={Locale.Plugin.Page.Search}
              name="plugin-search"
              autoComplete="new-password"
              aria-autocomplete="none"
              value={searchText}
              onInput={(e) => onSearch(e.currentTarget.value)}
            />

            <IconButton
              className="nextchat-primary-button"
              icon={<AddIcon />}
              text={Locale.Plugin.Page.Create}
              onClick={() => {
                const createdPlugin = pluginStore.create();
                setEditingPluginId(createdPlugin.id);
              }}
            />
          </div>

          <div className={pluginStyles["plugin-list"]}>
            {plugins.length == 0 && (
              <div className={pluginStyles["plugin-empty"]}>
                {Locale.Plugin.Page.Find}
                <a
                  href={pluginsRepoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <IconButton icon={<GithubIcon />} />
                </a>
              </div>
            )}
            {plugins.map((m) => (
              <div
                className={clsx(
                  styles["mask-item"],
                  pluginStyles["plugin-item"],
                )}
                key={m.id}
              >
                <div
                  className={clsx(
                    styles["mask-header"],
                    pluginStyles["plugin-item-header"],
                  )}
                >
                  <div className={styles["mask-icon"]}></div>
                  <div
                    className={clsx(
                      styles["mask-title"],
                      pluginStyles["plugin-item-title"],
                    )}
                  >
                    <div
                      className={clsx(
                        styles["mask-name"],
                        pluginStyles["plugin-item-name"],
                      )}
                    >
                      {m.title}
                    </div>
                    <div className={clsx(styles["mask-info"], "one-line")}>
                      {Locale.Plugin.Item.Info(
                        FunctionToolService.add(m).length,
                      )}
                    </div>
                  </div>
                </div>
                <div
                  className={clsx(
                    styles["mask-actions"],
                    pluginStyles["plugin-item-actions"],
                  )}
                >
                  <IconButton
                    className="nextchat-action-button"
                    icon={<PowerIcon />}
                    text={
                      m.enabled !== false
                        ? Locale.Plugin.Item.Enable
                        : Locale.Plugin.Item.Disable
                    }
                    style={{ marginRight: 8 }}
                    onClick={() => {
                      pluginStore.updatePlugin(m.id, (plugin) => {
                        plugin.enabled =
                          plugin.enabled === false ? true : false;
                      });
                    }}
                  />
                  <IconButton
                    className="nextchat-action-button"
                    icon={<EditIcon />}
                    text={Locale.Plugin.Item.Edit}
                    onClick={() => setEditingPluginId(m.id)}
                  />
                  {!m.builtin && (
                    <IconButton
                      className="nextchat-action-button"
                      icon={<DeleteIcon />}
                      text={Locale.Plugin.Item.Delete}
                      style={{ marginLeft: 8 }}
                      onClick={async () => {
                        if (
                          await showConfirm(Locale.Plugin.Item.DeleteConfirm)
                        ) {
                          pluginStore.delete(m.id);
                        }
                      }}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {editingPlugin && (
        <div className="modal-mask">
          <Modal
            title={Locale.Plugin.EditModal.Title(editingPlugin?.builtin)}
            className={pluginStyles["plugin-edit-modal"]}
            onClose={closePluginModal}
            actions={[
              <IconButton
                icon={<ConfirmIcon />}
                text={Locale.UI.Confirm}
                key="export"
                onClick={() => setEditingPluginId("")}
              />,
            ]}
          >
            <List className={pluginStyles["plugin-edit-list"]}>
              <ListItem title={Locale.Plugin.EditModal.Auth}>
                <DrawSelect
                  ariaLabel={Locale.Plugin.EditModal.Auth}
                  value={editingPlugin?.authType ?? ""}
                  options={[
                    { name: Locale.Plugin.Auth.None, value: "" },
                    { name: Locale.Plugin.Auth.Bearer, value: "bearer" },
                    { name: Locale.Plugin.Auth.Basic, value: "basic" },
                    { name: Locale.Plugin.Auth.Custom, value: "custom" },
                  ]}
                  onChange={(value) => {
                    pluginStore.updatePlugin(editingPlugin.id, (plugin) => {
                      plugin.authType = value;
                    });
                  }}
                />
              </ListItem>
              {["bearer", "basic", "custom"].includes(
                editingPlugin.authType as string,
              ) && (
                <ListItem title={Locale.Plugin.Auth.Location}>
                  <DrawSelect
                    ariaLabel={Locale.Plugin.Auth.Location}
                    value={editingPlugin?.authLocation ?? "header"}
                    options={[
                      {
                        name: Locale.Plugin.Auth.LocationHeader,
                        value: "header",
                      },
                      {
                        name: Locale.Plugin.Auth.LocationQuery,
                        value: "query",
                      },
                      { name: Locale.Plugin.Auth.LocationBody, value: "body" },
                    ]}
                    onChange={(value) => {
                      pluginStore.updatePlugin(editingPlugin.id, (plugin) => {
                        plugin.authLocation = value;
                      });
                    }}
                  />
                </ListItem>
              )}
              {editingPlugin.authType == "custom" && (
                <ListItem title={Locale.Plugin.Auth.CustomHeader}>
                  <input
                    type="text"
                    name="plugin-auth-header"
                    autoComplete="new-password"
                    aria-autocomplete="none"
                    className="nextchat-input-surface"
                    value={editingPlugin?.authHeader ?? ""}
                    onChange={(e) => {
                      pluginStore.updatePlugin(editingPlugin.id, (plugin) => {
                        plugin.authHeader = e.target.value;
                      });
                    }}
                  ></input>
                </ListItem>
              )}
              {["bearer", "basic", "custom"].includes(
                editingPlugin.authType as string,
              ) && (
                <ListItem title={Locale.Plugin.Auth.Token}>
                  <PasswordInput
                    name="plugin-auth-token"
                    autoComplete="new-password"
                    aria-autocomplete="none"
                    className="nextchat-input-surface"
                    value={editingPlugin?.authToken ?? ""}
                    onChange={(e) => {
                      pluginStore.updatePlugin(editingPlugin.id, (plugin) => {
                        plugin.authToken = e.currentTarget.value;
                      });
                    }}
                  ></PasswordInput>
                </ListItem>
              )}
            </List>
            <List className={pluginStyles["plugin-edit-list"]}>
              <ListItem title={Locale.Plugin.EditModal.Content}>
                <div className={pluginStyles["plugin-schema"]}>
                  <input
                    type="text"
                    name="plugin-schema-url"
                    autoComplete="new-password"
                    aria-autocomplete="none"
                    value={loadUrl}
                    className={clsx(
                      pluginStyles["plugin-schema-input"],
                      "nextchat-input-surface",
                    )}
                    onInput={(e) => setLoadUrl(e.currentTarget.value)}
                  ></input>
                  <IconButton
                    className={`${pluginStyles["plugin-schema-load"]} nextchat-action-button`}
                    icon={<ReloadIcon />}
                    text={Locale.Plugin.EditModal.Load}
                    onClick={() => loadFromUrl(loadUrl)}
                  />
                </div>
              </ListItem>
              <ListItem
                vertical
                subTitle={
                  <div
                    className={clsx(
                      "markdown-body",
                      pluginStyles["plugin-content"],
                    )}
                    dir="auto"
                  >
                    <pre>
                      <code
                        className="nextchat-input-surface"
                        contentEditable={true}
                        dangerouslySetInnerHTML={{
                          __html: editingPlugin.content,
                        }}
                        onBlur={onChangePlugin}
                      ></code>
                    </pre>
                  </div>
                }
              ></ListItem>
              {editingPluginTool?.tools.map((tool, index) => (
                <ListItem
                  key={index}
                  title={tool?.function?.name}
                  subTitle={tool?.function?.description}
                />
              ))}
            </List>
          </Modal>
        </div>
      )}
    </ErrorBoundary>
  );
}
