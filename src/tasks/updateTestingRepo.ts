import { TaskHandler } from "@cleverjs/utils";
import { AptlyAPI } from "../aptly/api";

export const UpdateTestingRepoTask = new TaskHandler.BasicTaskFn("testing-repo:update", async (payload: {}, logger) => {

    await AptlyAPI.Publishing.updateLiveTestingRepo();

    return { success: true };

});