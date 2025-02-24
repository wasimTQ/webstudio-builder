import store, { type Change } from "immerhin";
import { enableMapSet } from "immer";
import { atom, type WritableAtom } from "nanostores";
import { useEffect } from "react";
import { type Publish, subscribe } from "~/shared/pubsub";
import {
  projectStore,
  pagesStore,
  instancesStore,
  propsStore,
  breakpointsStore,
  stylesStore,
  styleSourcesStore,
  styleSourceSelectionsStore,
  assetsStore,
  selectedPageIdStore,
  selectedInstanceSelectorStore,
  selectedInstanceBrowserStyleStore,
  selectedInstanceUnitSizesStore,
  selectedInstanceIntanceToTagStore,
  selectedInstanceRenderStateStore,
  hoveredInstanceSelectorStore,
  isPreviewModeStore,
  synchronizedCanvasStores,
  synchronizedInstancesStores,
  synchronizedBreakpointsStores,
  selectedStyleSourceSelectorStore,
  synchronizedComponentsMetaStores,
} from "~/shared/nano-states";

enableMapSet();

type StoreData = {
  namespace: string;
  value: unknown;
};

type SyncEventSource = "canvas" | "builder";

declare module "~/shared/pubsub" {
  export interface PubsubMap {
    handshake: { source: SyncEventSource };

    sendStoreData: {
      // distinct source to avoid infinite loop
      source: SyncEventSource;
      data: StoreData[];
    };
    sendStoreChanges: {
      // distinct source to avoid infinite loop
      source: SyncEventSource;
      changes: Change[];
    };
  }
}

const clientStores = new Map<string, WritableAtom<unknown>>();
const initializedStores = new Set<string>();

export const registerContainers = () => {
  // synchronize patches
  store.register("pages", pagesStore);
  store.register("breakpoints", breakpointsStore);
  store.register("instances", instancesStore);
  store.register("styles", stylesStore);
  store.register("styleSources", styleSourcesStore);
  store.register("styleSourceSelections", styleSourceSelectionsStore);
  store.register("props", propsStore);
  store.register("assets", assetsStore);
  // synchronize whole states
  clientStores.set("project", projectStore);
  clientStores.set("selectedPageId", selectedPageIdStore);
  clientStores.set("selectedInstanceSelector", selectedInstanceSelectorStore);
  clientStores.set(
    "selectedInstanceBrowserStyle",
    selectedInstanceBrowserStyleStore
  );
  clientStores.set(
    "selectedInstanceIntanceToTagStore",
    selectedInstanceIntanceToTagStore
  );
  clientStores.set(
    "selectedInstanceUnitSizesStore",
    selectedInstanceUnitSizesStore
  );
  clientStores.set(
    "selectedInstanceRenderStateStore",
    selectedInstanceRenderStateStore
  );
  clientStores.set("hoveredInstanceSelector", hoveredInstanceSelectorStore);
  clientStores.set("isPreviewMode", isPreviewModeStore);
  clientStores.set(
    "selectedStyleSourceSelector",
    selectedStyleSourceSelectorStore
  );
  for (const [name, store] of synchronizedBreakpointsStores) {
    clientStores.set(name, store);
  }
  for (const [name, store] of synchronizedInstancesStores) {
    clientStores.set(name, store);
  }
  for (const [name, store] of synchronizedCanvasStores) {
    clientStores.set(name, store);
  }
  for (const [name, store] of synchronizedComponentsMetaStores) {
    clientStores.set(name, store);
  }

  // use listen to not invoke initially
  for (const [name, store] of clientStores) {
    // here we rely on the fact registerContainers is called before any store.set
    // is called to find which store is initialized to send its data to the other realm
    // this can help to find the direction between builder and canvas
    // so canvas could send initial data to builder without builder overriding it
    // with default store value
    const unsubscribe = store.listen(() => {
      initializedStores.add(name);
      unsubscribe();
    });
  }
};

const syncStoresChanges = (name: SyncEventSource, publish: Publish) => {
  const unsubscribeRemoteChanges = subscribe(
    "sendStoreChanges",
    ({ source, changes }) => {
      /// prevent reapplying own changes
      if (source === name) {
        return;
      }
      store.createTransactionFromChanges(changes, "remote");
    }
  );

  const unsubscribeStoreChanges = store.subscribe(
    (_transactionId, changes, source) => {
      // prevent sending remote patches back
      if (source === "remote") {
        return;
      }

      publish({
        type: "sendStoreChanges",
        payload: {
          source: name,
          changes,
        },
      });
    }
  );

  return () => {
    unsubscribeRemoteChanges();
    unsubscribeStoreChanges();
  };
};

const syncStoresState = (name: SyncEventSource, publish: Publish) => {
  const latestData = new Map<string, unknown>();

  const unsubscribeRemoteChanges = subscribe(
    "sendStoreData",
    ({ source, data }) => {
      /// prevent reapplying own changes
      if (source === name) {
        return;
      }
      for (const { namespace, value } of data) {
        // apply immerhin stores data
        const container = store.containers.get(namespace);
        if (container) {
          container.set(value);
        }
        // apply state stores data
        const stateStore = clientStores.get(namespace);
        if (stateStore) {
          // should be called before store set
          // to be accessible in listen callback
          latestData.set(namespace, value);
          stateStore.set(value);
        }
      }
    }
  );

  const unsubscribes: Array<() => void> = [];
  for (const [namespace, store] of clientStores) {
    unsubscribes.push(
      // use listen to not invoke initially
      store.listen((value) => {
        // nanostores cannot identify the source of change
        // so we check the latest value applied to the store
        // and do nothing if was set by synchronization logic
        if (latestData.has(namespace) && latestData.get(namespace) === value) {
          return;
        }
        latestData.set(namespace, value);

        publish({
          type: "sendStoreData",
          payload: {
            source: name,
            data: [
              {
                namespace,
                value,
              },
            ],
          },
        });
      })
    );
  }

  return () => {
    unsubscribeRemoteChanges();
    for (const unsubscribe of unsubscribes) {
      unsubscribe();
    }
  };
};

export const handshakenStore = atom(false);

const handshakeAndSyncStores = (
  source: SyncEventSource,
  publish: Publish,
  sync: (publish: Publish) => () => void
) => {
  const actions: Parameters<typeof publish>[0][] = [];

  // Until builder is ready store action in local cache
  const publishAction: typeof publish = (action) => {
    const destinationReady = handshakenStore.get();
    if (destinationReady) {
      return publish(action);
    }
    actions.push(action);
  };

  const unsubscribe = sync(publishAction);

  const handshakeAction = {
    type: "handshake",
    payload: {
      source,
    },
  } as const;

  publish(handshakeAction);

  const destinationStoreReady = subscribe("handshake", (payload) => {
    if (source === payload.source) {
      return;
    }

    const destinationReady = handshakenStore.get();
    if (destinationReady) {
      return;
    }

    // We need to publish it here last time
    publish(handshakeAction);

    for (const action of actions) {
      publish(action);
    }

    // cleanup
    actions.length = 0;

    handshakenStore.set(true);

    destinationStoreReady();
  });

  return () => {
    destinationStoreReady();
    unsubscribe();
  };
};

export const useCanvasStore = (publish: Publish) => {
  useEffect(() => {
    return handshakeAndSyncStores("canvas", publish, (publish) => {
      const unsubscribeStoresState = syncStoresState("canvas", publish);
      const unsubscribeStoresChanges = syncStoresChanges("canvas", publish);

      // immerhin data is sent only initially so not part of syncStoresState
      // expect data to be populated by the time effect is called
      const data = [];
      for (const [namespace, store] of clientStores) {
        if (initializedStores.has(namespace)) {
          data.push({
            namespace,
            value: store.get(),
          });
        }
      }
      publish({
        type: "sendStoreData",
        payload: {
          source: "canvas",
          data,
        },
      });

      return () => {
        unsubscribeStoresState();
        unsubscribeStoresChanges();
      };
    });
  }, [publish]);
};

export const useBuilderStore = (publish: Publish) => {
  useEffect(() => {
    return handshakeAndSyncStores("builder", publish, (publish) => {
      const unsubscribeStoresState = syncStoresState("builder", publish);
      const unsubscribeStoresChanges = syncStoresChanges("builder", publish);

      // immerhin data is sent only initially so not part of syncStoresState
      // expect data to be populated by the time effect is called
      const data = [];
      for (const [namespace, container] of store.containers) {
        data.push({
          namespace,
          value: container.get(),
        });
      }
      for (const [namespace, store] of clientStores) {
        if (initializedStores.has(namespace)) {
          data.push({
            namespace,
            value: store.get(),
          });
        }
      }
      publish({
        type: "sendStoreData",
        payload: {
          source: "builder",
          data,
        },
      });

      return () => {
        unsubscribeStoresState();
        unsubscribeStoresChanges();
      };
    });
  }, [publish]);

  useEffect(() => {
    return () => {
      handshakenStore.set(false);
    };
  }, []);
};
